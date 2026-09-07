# HTTP & WebSocket

## API

| 方法 | 路径 | 说明 |
|------|------|------|
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

读屏接口不修改活动版本；状态推断由轮询器负责。终端与翻页约束见 [cmux 集成](cmux-integration.md)。

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
| GET | `/api/files/preview?path=…` | 文本 / 图片 / 其他格式元信息；text 最多 128 KB |
| GET | `/api/files/download?path=…` | 最大 20 MB，默认附件；inline=1 仅用于受支持的光栅图片 |
| POST | `/api/files/operation` | JSON 操作，见下方 |
| GET | `/api/agents/:surfaceId/cwd` | 只提供当前 surface 的可访问工作目录提示，失败返回 path: null |

操作体：`{action:"create",directory,name,kind:"file"|"directory"}`、`{action:"rename",path,name}`、`{action:"copy",paths,directory}`。响应 `{ok:true,paths:[…]}`。同名返回 409，不覆盖；系统拒绝权限时返回 403；不存在返回 404；参数错误返回 400。写请求必须为 JSON，拒绝浏览器跨站提交。搜索的 limited 表示达到扫描时间 / 数量上限；目录可能在分页期间变化，刷新会重新读取。
