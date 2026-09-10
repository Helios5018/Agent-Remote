# HTTP & WebSocket

外部 Agent 的完整调用流程、参数上限和恢复约定见 [Agent HTTP 指南](agent-guide.md)，运行时入口 `GET /agent-guide.md`（匿名 Markdown）。

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/info` | 登录后实例 ID、serverVersion、agentApiVersion、demo、guidePath；no-store |
| `GET` | `/api/surfaces/:surfaceId/context` | 无副作用现场聚合，surfaceId 必须 UUID |
| `POST` | `/api/workspaces` | `{cwd,launch?:null}`，支持纯 Shell 或现有 Agent 枚举，201 返回真实 workspace/surface ID |
| `POST` | `/api/workspaces/:workspaceId/panes` | 新建 terminal 分屏 |
| `POST` | `/api/workspaces/:workspaceId/close` | `{confirm:true,surfaceIds}` 核对完整集合后关闭 workspace |
| `POST` | `/api/workspaces/:workspaceId/panes/:paneId/close` | 同上，核对 pane 全部 surface |
| `GET` | `/api/health` | 健康检查（无需登录） |
| `POST` | `/api/auth/login` | PIN 换 Session Cookie（带限流） |
| `GET` | `/api/auth/session` | 当前登录态 |
| `POST` | `/api/auth/logout` | 退出登录 |
| `GET` | `/api/agents` | Attention Inbox（分组 + 汇总） |
| `GET` | `/api/agents/:surfaceId` | Agent 详情 + 输出快照（并标记已读） |
| `POST` | `/api/agents/:surfaceId/read` | 显式标记已读 |
| `GET` | `/api/tree` | cmux 完整结构 |
| `POST` | `/api/surfaces` | `{ paneId, workspaceId?, launch? }` 在指定 pane 里新建 terminal surface |
| `POST` | `/api/surfaces/:surfaceId/close` | `{ confirm: true }` 关掉 cmux 里的真实 tab（进程一起没） |
| `GET` | `/api/surfaces/:surfaceId/output` | 读取输出（纯文本） |
| `GET` | `/api/surfaces/:surfaceId/grid` | 读取彩色渲染网格 |
| `GET` | `/api/surfaces/:surfaceId/history` | 网格之外更早的历史（纯文本，`?drop=` 去掉与网格重叠的尾部） |
| `POST` | `/api/surfaces/:surfaceId/scroll` | `{ action }` 翻页：`pageup` / `pagedown` / `bottom`，响应带回新画面 |
| `POST` | `/api/surfaces/:surfaceId/input` | `{ text, submit }` 输入内容 |
| `POST` | `/api/surfaces/:surfaceId/key` | `{ key, confirm }` 发送按键 |
| `POST` | `/api/hooks/:agent` | Hook 上报（独立 Hook 密钥，仅限本机回环） |
| `GET` | `/api/audit` | 最近的写操作审计 |

允许的按键：`enter` `escape` `tab` `up` `down` `left` `right` `ctrl+c` `ctrl+p`。
按键条在手机上是单行横滑的；`ctrl+p` 只在识别为 Pi 的会话中显示，用于快速切换模型。
不提供 `ctrl+d`：实测对着 shell 发 EOF 会直接把 surface 关掉。

`/scroll` 翻页不往终端里写内容，只是让终端里的程序换一屏来画。它不收 `home` / `end`
—— 那两个键 cmux 虽然认，但对 Claude Code 画面纹丝不动，对 shell 又变成移动光标。
`bottom` 没有对应按键，是服务端连按 `pagedown` 直到画面不再变化（最多 12 步）。

WebSocket `/ws`：

```jsonc
// 客户端 → 服务端
{ "type": "subscribe", "surfaceId": "…" }   // 正在查看的 surface；null 表示离开会话页
{ "type": "ping" }

// 服务端 → 客户端
{ "type": "hello", "serverVersion": "0.1.0", "now": 0 }
{ "type": "agent.status_changed", "surfaceId": "…", "status": "NEEDS_APPROVAL", "agent": { … } }
{ "type": "agent.list_changed", "inbox": { … } }
{ "type": "surface.snapshot", "surfaceId": "…", "revision": 128, "content": "…" }  // 纯文本，给后台变化检测
{ "type": "surface.grid", "surfaceId": "…", "grid": { … } }                       // 会话页彩色画面
{ "type": "pong", "now": 0 }
{ "type": "error", "code": "…", "message": "…" }
```

## 改名

- `POST /api/surfaces/:surfaceId/title`：`{ title }`，修改真实 tab 名。
- `POST /api/workspaces/:workspaceId/title`：`{ title }`，修改 workspace 名。

context/history 不推进 SnapshotTracker；旧 output/Agent 详情接口仍更新文本快照跟踪器，状态推断由轮询器负责。终端与翻页约束见 [cmux 集成](cmux-integration.md)。

## 输入与创建的部分失败

`POST /api/surfaces/:surfaceId/input` 成功仍返回 `{ "ok": true }`，表示 cmux 已确认文本/按键操作。`text: "", submit: true` 只发送 Enter。

执行异常返回 HTTP 500 和标准 `error` 对象：

| code | 已知事实与恢复方式 |
|---|---|
| `INPUT_TEXT_WRITTEN_SUBMIT_UNKNOWN` | 文本写入已确认，Enter 操作异常；可能已经提交。检查终端后决定是否仅补 Enter，不应直接重发正文 |
| `INPUT_DELIVERY_UNKNOWN` | 文本写入或单独 Enter 的结果未知；检查终端后再操作 |

认证、参数校验等在执行前明确拒绝的请求保留原错误响应。网络断开或无效成功响应也应按结果未知处理，客户端不自动重试输入。审计仅记录目标、正文长度、提交标记与失败阶段，不记录正文。

`POST /api/surfaces` 在 tab 已创建而启动命令异常时仍返回 HTTP 201、`ok: true` 和真实 `surfaceId`，`launched` 为 `null`，追加可选字段：

```json
{ "launchError": { "stage": "submit_unknown", "message": "tab 已创建，启动命令已写入，但回车结果未知。请打开会话核对；若命令仍在输入行，仅补发 Enter。" } }
```

`stage` 为 `text_unknown` 或 `submit_unknown`。成功返回的 `launched` 仅代表启动命令已提交，不是 Agent 进程就绪证明。创建请求整体响应丢失时无法获得可靠的 surfaceId，应检查最新结构树，不能自动重新创建。

## 文件模块

以下接口均需登录，不需要 `surfaceId`，可以访问整台 Mac 的文件系统，读写权限由 macOS 当前用户决定。文件响应不缓存。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/files/roots` | 系统根目录 roots 与当前用户主目录 home |
| GET | `/api/files/list?path=…&q=…&mode=filter&hidden=0&offset=0` | 每页 100 项；mode 为 filter / name / content；next 为下一页偏移或 null |
| GET | `/api/files/preview?path=…` | kind 为 text / image / video / audio / other；text 最多 128 KB |
| GET | `/api/files/download?path=…` | 最大 20 MB，默认附件；inline=1 仅用于受支持的光栅图片 |
| GET / HEAD | `/api/files/media?path=…` | 鉴权音视频流；支持单段 Range（206）、无效范围返回 416；按 64 KB 分块读取，无 20 MB 播放上限 |
| POST | `/api/files/operation` | JSON 操作，见下方 |
| GET | `/api/agents/:surfaceId/cwd` | 只提供当前 surface 的可访问工作目录提示，失败返回 path: null |

操作体：`{action:"create",directory,name,kind:"file"|"directory"}`、`{action:"rename",path,name}`、`{action:"copy",paths,directory}`。响应 `{ok:true,paths:[…]}`。同名返回 409，不覆盖；系统拒绝权限时返回 403；不存在返回 404；参数错误返回 400。写请求必须为 JSON，拒绝浏览器跨站提交。搜索的 limited 表示达到扫描时间 / 数量上限；目录可能在分页期间变化，刷新会重新读取。

剪切粘贴使用 `{action:"move",paths,directory}`，返回 `{ok,paths,failed}`；paths 为已成功移动的源路径，failed 为失败路径及原因。同名目标不会覆盖。跨文件系统移动先复制到目标盘暂存目录，确认源内容未变化后发布并移除源文件。

删除接口分两步且绑定同一个登录 Session（界面中废纸篓仅确认一次并连续调用两步，永久删除保留两次确认）：先提交 `{action:"delete_prepare",paths,mode?:"trash"|"permanent"}` 获得 `{ok:true,paths,token}`，此步骤不删除文件；界面完成对应确认后提交 `{action:"delete",token,confirm:true}`。令牌有效期 2 分钟，仅能使用一次。服务端核验文件及目录内容在确认期间未变化，删除软链接只删除链接本身。mode 默认 permanent 为永久删除；trash 调用 macOS 原生废纸篓接口，模式绑定在确认令牌中，提交时不能切换；系统根目录不能删除。批量删除结果同样包含已成功删除的 paths 和 failed；确认阶段最多检查 10000 个目录项。


## 实例与现场合同（agentApiVersion 1）

`GET /api/info` 返回 `{instanceId,serverVersion,agentApiVersion:1,demo,guidePath:"/agent-guide.md"}`。instanceId 存储于实际 `config.dbPath` 数据库的 settings；初始化只插入不存在的键再回读。同数据库重启/换 PIN/换 URL 不变，新库新 ID；数据库复制也复制身份，不能作为硬件标识或认证凭据。

`GET /api/surfaces/:surfaceId/context` 返回 `{instanceId,surface,agent,cwd,git,output,issues,fetchedAt}`，no-store。surface 含 id/title/type/paneId/workspaceId/workspaceTitle；agent 可 null，否则含 kind/sessionId/status/currentActivity/hookConnected/lastActivityAt，未知状态为 null；cwd 可 null；git 可 null，否则 `{root,branch,hasChanges}`；output 可 null，否则 `{content,fetchedAt,limitLines:200,limited}`，最近 200 行且 64 KiB，UTF-8 完整。issues 为 `{section,code,message}[]`；section 为 cwd/git/output，对应 CWD_UNAVAILABLE/GIT_UNAVAILABLE/OUTPUT_UNAVAILABLE。

聚合不标记已读、不发送输入、不翻页、不推进输出跟踪器或保存终端全文。总 fetchedAt 为毫秒聚合完成时间，不是事务快照；limited false 不代表历史完整。401 未登录、400 非 UUID、404 确定不存在、503 核心拓扑不可用；分段失败为 200、null 和 issues。Git 摘要不执行 fetch，cwd 只使用目标 surface 线索。

`POST /api/workspaces` 的 launch 缺省/null 为纯 Shell，cwd 为可访问绝对目录（1–4096 字符，无控制字符），Agent 模式兼容既有枚举。Shell 初始化仅发送安全引用的 cd，Agent 模式追加白名单命令。201 不保证目录生效或 Agent 就绪；初始化失败返回真实 ID 和字符串 launchError；正文已写入而 Enter 结果未知时只在核对后补 Enter，不能重发正文或重复创建。

Git 各接口、上传完整 headers、文件删除同 Session 合同及所有上限详见 [在线指南对应合同](agent-guide.md#3-http-合同)。指南正文唯一源为 docs/agent-guide.md，生产入口在 SPA 静态回退之前路由；部署需携带它，源缺失/为空返回 503。
