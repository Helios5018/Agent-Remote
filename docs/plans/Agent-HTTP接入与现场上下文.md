# Agent HTTP 接入与现场上下文实施计划

日期：2026-09-10

状态：源码、文档、自动化与本机真实 cmux 验收已完成；正式公网尚未发布。详见 [验收记录](Agent-HTTP接入与现场上下文-验收记录.md)，包含测试隔离事故及恢复限制。本文保留原实施设计。

## 1. 目标与交付范围

让能够发送 HTTP 请求的外部 Agent，仅凭服务地址、Access PIN 和在线说明，就能发现本机 cmux 会话、了解现场、发送任务、使用专用 Shell，并通过文件和 Git 接口获取项目资料。

使用入口是一份直接给 Agent 读的 Markdown，不做 Skill、MCP、SDK 或工具包装。继续复用网页使用的 HTTP API。第一版交付：

1. `GET /agent-guide.md`：完整、可直接照做的在线使用说明。
2. `GET /api/info`：登录后的服务实例信息，用于地址变化后的关联核验。
3. `GET /api/surfaces/:surfaceId/context`：聚合一个会话的现场信息。
4. 扩展 `POST /api/workspaces`，支持 `launch: null` 创建纯 Shell workspace。
5. 在说明中约定客户端最少状态、登录复用、地址与凭证更新、结果未知时的恢复方式。
6. 同步仓库 API 文档和 README 入口，完成相称的自动化与运行验证。

第一版不增加任务系统、交接卡、后台摘要、完整会话日志读取、项目注册表、服务发现平台、结构化命令执行 Job、请求幂等存储、权限分级或新的认证体系。前端无需增加入口或改变既有操作流程。

本次编写计划不修改源码、不部署服务、不提交或推送代码。后续实现与发布分别按当时的授权执行。

## 2. 已核对的现状

依据：`apps/server/src/app.ts`、`api/`、`security/`、`cmux/`、`services/`、`packages/protocol/src/` 及 `docs/api.md`。

| 能力 | 当前接口 | 需要在指南里写清楚的事实 |
| --- | --- | --- |
| 健康检查 | `GET /api/health` | 无需登录；含版本、demo 标记和时间，不证明 cmux 可用 |
| 认证 | `POST /api/auth/login`；`GET /api/auth/session`；`POST /api/auth/logout` | 登录体为 `{token: PIN}`；后两者根据 Cookie 工作 |
| 全部会话结构 | `GET /api/tree` | Workspace → Pane → Surface；包含普通 Shell，不能只靠 Agent 列表找终端 |
| Agent 状态 | `GET /api/agents` | 分组状态；不是任务完成判定协议 |
| Agent 详情 | `GET /api/agents/:surfaceId` | 返回状态和输出，同时标记已读 |
| 工作目录、已读 | `GET /api/agents/:surfaceId/cwd`；`POST /api/agents/:surfaceId/read` | cwd 来自进程探测，可能为 null，不是项目身份 |
| 创建 workspace | `POST /api/workspaces` | 当前必填 cwd 和 Agent launch；尚不支持纯 Shell |
| workspace 操作 | `POST /api/workspaces/:workspaceId/title`、`…/close`、`…/panes` | 改名、关闭、新建分屏 |
| 关闭分屏 | `POST /api/workspaces/:workspaceId/panes/:paneId/close` | 关闭请求需确认当时完整 surface 集合，拓扑变化时拒绝 |
| 创建终端 | `POST /api/surfaces` | 指定 paneId，可选 workspaceId；launch 默认为 null，可创建普通 Shell |
| 终端操作 | `POST /api/surfaces/:surfaceId/input`、`…/key`、`…/title`、`…/close` | 输入、按键、改名、关闭真实 tab；写操作必须明确目标 |
| 终端读取 | `GET /api/surfaces/:surfaceId/output`、`…/grid`、`…/history` | 文本、网格、普通屏历史；不等于完整 Agent 对话 |
| TUI 翻页 | `POST /api/surfaces/:surfaceId/scroll` | 改变真实 TUI 视图；使用后主动 bottom 复位 |
| 文件读取 | `GET /api/files/roots`、`…/list`、`…/preview`、`…/download`、`…/media` | 文件接口不依赖 cmux；受当前 macOS 用户权限和体积限制 |
| 文件修改 | `POST /api/files/operation` | create、rename、copy、move、delete_prepare、delete；不提供正文编辑 |
| 上传 | `POST /api/files/upload` | 原始二进制上传；需文件名、大小和 surface 关联头，不是 multipart；需在指南列全 headers |
| Git 读取 | `GET /api/git/status`、`…/branches`、`…/history`、`…/commit`、`…/content`、`…/diff` | 接受目录路径；按需读取，展示有截断限制 |
| Git fetch | `POST /api/git/fetch` | 会更新远程跟踪信息，不是纯读取，不做 pull / checkout / commit |
| 审计 | `GET /api/audit` | 最近操作元数据，不含 prompt 或终端全文 |
| 实时变化 | WebSocket `/ws` | 已有订阅；初次接入可以先用 HTTP 轮询 |
| Hook | `POST /api/hooks/:agent` | 独立 Hook 密钥，仅本机回环；外部 Agent 不使用 |

现有认证接受 `Authorization: Bearer <PIN>` 和 `x-car-token`，但没有 Cookie 时每次验证会建立新 Session。文件删除的准备与确认绑定同一 Session，因此持续调用的默认范式必须是登录后复用 Cookie；不能用两次独立 Bearer 请求演示完整删除流程。

当前服务有 SPA 静态文件回退。单纯在 Hono 注册 `/agent-guide.md` 可能被 `index.ts` 的静态处理提前返回 HTML，实施时必须处理真实运行入口，而不只测试 `app.request()`。

## 3. 身份与连接约定

### 3.1 三类信息分开保存

| 信息 | 例子 | 生命周期 |
| --- | --- | --- |
| 客户端固定别名 | `link-mac` | 由用户或客户端指定；网址变化不改名 |
| 服务实例 ID | `instanceId` UUID | 跟随服务数据库持久化，不跟随 URL、PIN 或进程 |
| 连接配置 | baseUrl、凭证来源、Cookie 文件 | 可以更新或失效 |

`instanceId` 表示一个服务安装的数据身份，不是硬件序列号、项目 ID，也不是身份认证凭据。它只能在可信地址与正常认证的基础上辅助关联。

项目第一版按“已确认实例 + 具体项目目录 / worktree 目录”定位；Git 信息辅助核对。不强行把 workspace 当项目，不把同一仓库的多个 checkout / worktree 合并。目录迁移后重新核对并更新本地定位，不提供自动追踪移动的承诺。

### 3.2 instanceId 的存储和接口

新增 `GET /api/info`，放在现有 `requireAuth` 之后，响应示例：

```json
{
  "instanceId": "持久化 UUID",
  "serverVersion": "服务版本",
  "agentApiVersion": 1,
  "demo": false,
  "guidePath": "/agent-guide.md"
}
```

- 复用 StateStore 的 settings 表，键建议为 `instance_id`，不引入新数据库表。
- 首次初始化生成 UUID，后续启动读取同一值；初始化采用插入不存在才创建并回读的方式，避免并发启动覆盖已有 ID。
- 实际持久化位置跟随 `config.dbPath`：默认在数据目录中，但 `CAR_DB` / `--db` 可以独立指定。更换数据目录不必然改变实例，更换为新数据库才会。
- 同一数据库下重启、PIN 轮换、隧道变化保持 ID；恢复数据库备份保持 ID；复制数据库到另一服务也会复制 ID，需要明确这是数据身份而非硬件唯一性。
- `agentApiVersion` 第一版为 1，用于说明和客户端兼容判断；兼容性增字段不升主版本，破坏性变更再升。
- `Cache-Control: no-store`；不在响应中返回 PIN、Cookie、本机目录等无关信息。
- 不改变现有 `/api/health` 的匿名健康检查语义。

### 3.3 地址或凭证变化后的恢复

1. 新地址或新凭证由用户或其已配置的可信渠道提供。服务不猜地址、不自动寻找凭证。
2. 更新别名对应的 baseUrl / 凭证来源；指南地址通过新 baseUrl 加 `guidePath` 重新组成。
3. 地址变化时新建 Cookie jar 并登录，不手工把旧域 Cookie 转移到新域；凭证变化时使用新凭证建立新 Session。
4. 读取 `/api/info` 核验 instanceId。相同则保留项目记录；不同则视为另一实例或数据重建，重新发现并确认关联后再沿用旧操作目标。
5. 重新读取 tree 和目标 context。旧 UUID 只是定位线索；目标已不存在或角色已变时重新选择。
6. 保留此前“结果未知”的操作记录。重新登录成功不意味着此前操作没有执行，不自动重放。

PIN 轮换与既有 Session 撤销是不同问题。说明必须按实际认证实现描述，不能声称换 PIN 自动使所有旧 Cookie 失效；本次不扩展 Session 撤销策略。

## 4. 会话现场聚合接口

### 4.1 请求与返回合同

新增 `GET /api/surfaces/:surfaceId/context`，要求登录，使用 surface UUID。覆盖 Agent 与普通 Shell。第一版不加复杂 include 组合或批量聚合全机输出。

返回结构草案，实施时在 protocol 中定义 Zod schema 和类型：

```json
{
  "instanceId": "UUID",
  "surface": {
    "id": "surface UUID",
    "title": "Codex",
    "type": "terminal",
    "paneId": "pane UUID 或 null",
    "workspaceId": "workspace UUID",
    "workspaceTitle": "Agent-Remote"
  },
  "agent": {
    "kind": "codex",
    "sessionId": null,
    "status": "WORKING",
    "currentActivity": null,
    "hookConnected": true,
    "lastActivityAt": 0
  },
  "cwd": "/绝对工作目录",
  "git": {
    "root": "/仓库或 worktree 根目录",
    "branch": "main",
    "hasChanges": true
  },
  "output": {
    "content": "最近终端文本",
    "fetchedAt": 0,
    "limitLines": 200,
    "limited": true
  },
  "issues": [],
  "fetchedAt": 0
}
```

- 时间字段统一使用项目现有毫秒时间戳，不混入另一套日期格式。
- `agent`、`cwd`、`git`、`output` 可为 null。识别出 Agent 类型但尚无状态时，保留类型，状态为 null，不能默认 IDLE；`agent: null` 也不证明当前前台一定是 Shell。
- 普通 Shell 没有 Agent 状态是正常情况；非 Git 目录的 `git: null` 也是正常情况。
- `issues` 记录部分缺失，采用固定结构 `{section, code, message}`；例如 cwd 无法确定、Git 查询失败、输出读取失败。避免泄露原始命令环境或凭证。
- 文本默认最多 200 行、总计最多 64 KiB，取最近尾部并正确处理 UTF-8。`limited` 表示存在本次限额截断或达到读取上限；即便 false，也不能声称历史完整。
- 不把聚合输出的指纹冒充现有轮询器的 `outputRevision`。第一版无需在这里新增输出版本机制；客户端可以自行比较文本摘要。
- `fetchedAt` 是聚合完成时间，不是跨接口事务快照时间；cwd、Git、Agent 状态可能在采集期间变化。

### 4.2 读取行为与失败处理

1. 通过结构树确定 UUID 对应的 workspace / pane / surface。
2. 从 StateEngine 读取状态，不能调用会标记已读的 Agent 详情处理器。
3. 独立读取目标 surface 的 cwd 和最近文本；Git 查询依赖 cwd，按顺序执行。
4. cwd 探测只使用目标 surface 的进程线索，不回退成同 pane 另一个 surface 的目录。
5. Git 只返回摘要，不自动 fetch、不递归读取项目文档、不返回完整 Diff 或大文件列表。优先复用已有服务；若现有 status 内部代价过高，抽取最小摘要查询，而不构造新的项目索引。
6. 最近文本读取使用不会推进 SnapshotTracker 的路径，避免读取 200 行和轮询器另一限额交替导致输出版本抖动。已核对当前 `readSurface` 总会调用 `snapshots.update`，因此不能直接原样复用；需抽取无跟踪读取方法或提供明确的无跟踪选项，返回不带跟踪版本的文本与时间，并保留原调用方行为。现有 `readHistory` 虽然不进 tracker，但固定读取 scrollback，不能简单拿它替代当前画面读取。
7. context 不发送按键、不翻页、不标记已读、不推断任务完成，也不持久化终端全文。
8. 复用已有树缓存、命令超时及限额，不新增后台全机扫描。聚合读取完成后返回，不为某一不可用分段无限等待。

HTTP 行为：未登录 401；无效参数 400；明确不存在的目标 404；核心拓扑不可用 503；目标已确定但某些分段不可用时 200 并携带 null 与 issues。采集期间目标消失可以返回部分结果及说明，客户端必须在写入前重新核对，不承诺读写原子性。

README、AGENTS.md、代码和完整 Git 信息继续通过既有文件 / Git API 按需读取。读取规则文件时考虑父目录和目标子目录的适用范围，不把 cwd 下单个文件视为所有项目规则。

## 5. 纯 Shell workspace

扩展 `CreateWorkspaceRequestSchema`：

```json
{
  "cwd": "/已存在的绝对目录",
  "launch": null
}
```

- launch 接受现有 Agent 枚举或 null；缺省按 null 处理。原有显式 Agent 请求保持兼容。
- 继续验证 cwd 存在、可访问且不含控制字符。
- 创建真实 terminal workspace，沿用新终端唤醒流程；只向新建 surface 发送初始化输入。
- Shell 模式只提交经过现有可靠单引号转义的 `cd -- <cwd>`；Agent 模式继续提交 `cd -- <cwd> && <白名单命令>`。
- 不接受客户端任意 launch 命令。后续 Shell 输入走现有 surface input API。
- 保留当前响应字段及 `launchError` 的兼容性。创建已经成功但目录初始化或启动发生异常时，返回真实 workspaceId / surfaceId 和明确错误说明，不能提示重新创建。
- `201` 和初始化命令发送成功不等于 cwd 已确认或程序已就绪；调用者需要读取 context / 输出核对。对正文已写入但 Enter 未确认等状态使用准确说明，不重复发送整段初始化命令。
- 创建响应整体丢失时，先刷新结构树识别新增会话；无法确定归属时停止重复创建并报告情况。
- 前端继续传原 Agent 值，无需为本次 API 接入增加 UI。通过类型检查和现有回归检查兼容性。

## 6. 在线指南

### 6.1 文件与路由

以 `docs/agent-guide.md` 为唯一指南正文源，通过 `GET /agent-guide.md` 提供：

- 公开可读，内容只含通用合同和占位示例，不含实际地址、凭证、本机目录或会话内容。
- 返回 `Content-Type: text/markdown; charset=utf-8`，`Cache-Control: no-cache`。
- 文件路径按源码模块位置解析，不依赖启动 cwd。缺失时明确报错，不返回 SPA HTML 或成功空文档。
- 在生产 `index.ts` 中将这个固定路径明确交给 Hono，并放在静态 SPA 回退之前；无前端 dist 时也可读取。
- 当前服务直接运行 Bun 源码，指南随仓库一同部署；若未来打包方式改变，构建必须携带该唯一源文件。
- 指南中使用相对接口路径与 baseUrl 占位符，不固定公网域名。前端 hash 路由不是 API baseUrl 的一部分。
- README 添加一个入口；`docs/api.md` 同步接口合同，避免在多个位置复制维护整套调用教程。

### 6.2 正文结构

指南采用直接的操作说明，无产品宣传，按以下顺序组织：

1. 输入条件：用户授权范围、baseUrl、Access PIN；区分 Access PIN、Session Cookie、Hook 密钥。
2. 最短接入流程：登录 → info → tree → context → 明确目标后 input → 观察结果。
3. Cookie 持久化、登录过期、429 和 `Retry-After`、退出登录。
4. 全量 HTTP 接口合同：方法、路径、参数、响应、上限、副作用、错误恢复；参数和例子逐项对照 Zod 与路由代码。
5. workspace / pane / surface 与项目目录的关系，UUID 优先于易变化短引用；标题只用于展示与查找提示。
6. 项目了解方式：cwd、Git 根目录、适用规则文件和 README；不假设终端包含完整上下文。
7. 完整流程例子：查看工作现场、给已有 Agent 发任务、创建纯 Shell 执行无害命令、上传后引用路径、下载产物。
8. 文件修改与两阶段删除的准确合同。`confirm: true` 是请求确认标记，不代表系统取得了新的用户授权；动作依照任务既有授权范围执行。
9. 输入成功、Agent 就绪、任务完成之间的区别；网络超时与部分失败的恢复矩阵。
10. 客户端最少状态、地址和凭证轮换后的恢复。
11. 按需进阶：WebSocket 订阅、TUI 历史与复位、文件 / Git 大小及分页限制。

所有复制即用示例保持一致的 baseUrl 和 Cookie jar；使用真实 JSON 序列化处理任意文本，不能靠 shell 字符串拼接构造任务正文。凭证不放 URL、示例输出或项目文件。写请求不得通过客户端库默认重试策略自动重放。

## 7. Agent 客户端使用范式

这里约定行为，不要求安装客户端程序，也不要求所有 Agent 使用同一种本地目录结构。

### 7.1 最少本地状态

单次进程内使用可只保存在内存。跨回合 / 跨进程需要继续时，可按固定连接别名保存：

```text
<Agent 自己的私有状态目录>/agent-remote/link-mac/
  connection.json   # baseUrl、guidePath、预期 instanceId、凭证来源引用
  cookies.txt       # Session Cookie，权限 0600
  state.json        # 项目目录、已知 UUID、最近观察和未确认操作
```

- 这是说明示例，不在远端项目仓库创建这些文件，也不强制采用某个操作系统的目录约定。
- 父目录仅当前用户可访问；凭证与普通项目记录分离，不进入 Git 或日志。
- 有现成秘密管理工具则保存凭证引用；没有则优先本次输入 PIN 后仅持久化 Cookie，不要求长期保存 PIN。
- 状态按连接别名和已核验 instanceId 关联，不能按 URL 或 token 建一份新的项目记录。
- 项目记录只保存定位所需信息，不长期复制整个结构树、终端历史或项目文档。
- 下载产物按当前任务需要保存，结束后清理不用的临时文件。

### 7.2 观察、操作、再观察

1. 读取最新 tree / context，确认实例、目标 UUID、程序、目录和任务相关性。
2. 每次操作明确 surfaceId；普通 Shell 和 Agent 输入含义不同，未知前台程序不能当 Shell 使用。
3. 同一客户端对同一 surface 串行发送写操作；不声称这能阻止其他客户端同时输入，第一版没有跨客户端排他锁。
4. 发送前可持久化最小操作记录：本地操作 ID、目标、时间、动作类型、正文长度或摘要、状态。不必默认保存完整 prompt。
5. 成功后记为“输入已确认”；执行前明确拒绝记为“被拒绝”；超时、响应丢失或交付异常记为“结果未知”。本地 ID 不具备服务端幂等作用。
6. 观察输出和 Agent 状态判断后续动作。输出停止、IDLE 或输入返回 ok，均不能独立证明业务任务完成。
7. 轮询可从约 2 秒开始，无变化逐步退到 5–10 秒；耗时较大的 context 按需读取，频繁观察可用现有轻量状态 / 输出接口。
8. 普通屏回看用 history；TUI 翻页会影响真实会话视图，必要时使用，结束后主动 bottom，不能依赖网页替 HTTP 客户端复位。

### 7.3 恢复矩阵

| 情况 | 行为 |
| --- | --- |
| 401 | 重新登录并核对实例；不循环猜 PIN |
| 429 | 尊重 Retry-After；保留当前操作状态 |
| HTML / 非合同 JSON 响应 | 当作协议或入口异常；写操作按结果未知处理，不能只看 HTTP 200 |
| 404 surface | 刷新结构树，不拿同名 tab 自动替换旧目标 |
| `INPUT_TEXT_WRITTEN_SUBMIT_UNKNOWN` | 检查画面，必要时只补 Enter，不重发正文 |
| `INPUT_DELIVERY_UNKNOWN` 或写请求断网 | 先核对现场，无法判断则报告，不盲目重试 |
| 创建成功并带初始化错误 | 复用返回的 UUID，检查已有终端，不再创建 |
| 创建响应丢失 | 核对结构树中的新会话，不能自动再创建 |
| 新 URL / 新 PIN | 按第 3.3 节更新连接并重登，项目记录保留，旧操作不重放 |
| instanceId 不同 | 不沿用旧目标写入；重新发现并确认关联 |

## 8. 实施批次与主要文件

各批次按依赖顺序推进，范围内无需增加后台任务或新基础设施。

| 批次 | 工作 | 主要文件 | 完成条件 |
| --- | --- | --- | --- |
| A | 定义 info / context schema；workspace launch 可空；实例初始化 | `packages/protocol/src/api.ts`、协议 exports、`state/store.ts`、`context.ts`、`index.ts` | 合同明确，实例持久化可验证，原 schema 调用兼容 |
| B | info 路由和纯 Shell workspace | `api/info.ts`（新增）、`app.ts`、`api/workspaces.ts` | 鉴权、固定 ID、Shell 目录初始化、部分失败响应可验证 |
| C | 现场聚合 service / 路由，无跟踪输出读取 | `services/surface-context.ts`（新增）、`api/surfaces.ts`、必要时 `cmux/client.ts` / `cli-client.ts` / `fake-client.ts` | Agent / Shell 都可读，分段失败可恢复，读取不改变会话状态或输出 tracker |
| D | 在线指南及生产路由；同步文档入口 | `docs/agent-guide.md`（新增）、固定文档路由、`app.ts`、`index.ts`、`docs/api.md`、`README.md` | 真正 HTTP 返回 Markdown；示例与当前合同一致 |
| E | 目标测试、真实运行冒烟、发布准备 | `apps/server/test/` 对应测试与验收记录 | 下列验收通过，限制和实际发布状态记录清楚 |

实现时优先复用现有依赖注入、FakeCmuxClient、StateStore 和 GitService，不从 HTTP handler 内部发 HTTP 调另一个 handler。上下文聚合直接调用服务层。

## 9. 测试与验收

### 9.1 有意义的自动化覆盖

- 实例：同一数据库重新打开 ID 不变；不同新数据库 ID 不同；重复初始化不覆盖；info 需登录且不泄露凭证。
- context：Agent / 普通 Shell / 非 Git 目录；cwd 探测失败；Git 或输出失败；目标缺失与核心 cmux 故障；响应限额与 UTF-8 完整性。
- 读取副作用：读前后的 lastViewedAt、Agent 状态、SnapshotTracker 版本不因聚合读取变化；无 sendText / sendKey / scroll 调用。
- Shell workspace：null / 缺省 launch、原 Agent 值；含空格和单引号目录；目录验证失败；创建成功后初始化部分失败保留 UUID；仅操作新建终端。
- 文档路由：有 dist / 无 dist 都返回 Markdown；任意启动 cwd 可定位指南；缺文件不回退 HTML。
- 认证流程：一次登录后复用 Cookie；在隔离临时目录验证文件删除 prepare / confirm 使用同一 Session；文档不演示反复 Bearer 替代 Session。

沿用既有 fixture 和故障注入，不为 Markdown 排版或单纯字段转发写镜像测试。实现后运行对应目标测试，再完成 `bun run typecheck`、`bun run test`、`bun run build`、`git diff --check`。通过后仅在新改动、失败或未解决疑点出现时重跑相关验证。

### 9.2 从外部 Agent 视角验收

1. 只提供 baseUrl、PIN、guidePath，用独立 HTTP 客户端完成登录、info、tree、context。
2. 在受控的临时 workspace 创建 Shell，发送 `pwd` 等无害命令，观察目录和结果；不向用户正在工作的会话注入测试任务。
3. 按指南读取测试项目 README / 规则和 Git 状态，完成临时文件上传、读取、下载；删除仅测试本次创建的临时文件。
4. 在测试客户端模拟新 baseUrl / Cookie jar 并重登同一实例，证明本地别名、项目目录和有效 UUID 不必重建；对另一测试实例验证 ID 不同时不沿用旧写目标。
5. 在隔离测试环境验证凭证变更和服务重启后的实例稳定性，不轮换真实用户 PIN 来做测试。
6. 验证响应丢失后不会根据指南重发正文或重复创建 workspace。

需要持续运行的测试服务放 tmux，优先复用已有适合的 demo 服务；新 session 遵循 `agent-remote-<用途>`，端口先查空闲。启动后记录 session、命令、端口、日志与停止命令。测试结束只清理本次创建的服务、会话和无用文件。

### 9.3 发布与完成定义

用户后续授权更新线上服务时，读取适用 launch-public skill 和公网运维文档，按原地 refresh 流程复用现有 tmux、4318、隧道与入口。不得为了测试地址变更而重建正式隧道。

发布后验证本地与公网的 guide、health、登录后 info / context；比较两个入口的 instanceId；若前端产物被重新构建，按项目规则核验公网资源哈希与 dist 一致。

验收记录区分：源码完成、自动化通过、真实 cmux 验证、公网发布。未运行的项目明确标为未验证，不用 demo 通过替代真实验收。

最终交付应满足：外部 Agent 无需访问仓库或安装包装，能照在线说明完成一次完整操作；URL / PIN 变化只更新连接，不丢失项目关联；现场读取不冒充完整上下文；未知执行结果有明确恢复路径。

## 10. 后续扩展触发条件

仅当实际使用暴露需求时再评估：

- 频繁需要退出码和完整 stdout / stderr：独立命令 Job API。
- 网络中断导致重复创建 / 输入难以恢复：服务端请求去重及状态查询。
- 多个控制者经常争用同一 surface：会话写入协调或租约。
- 多台机器或多个 worktree 的项目定位成本明显上升：项目身份与发现机制。
- 固定域名与人工更新入口不再够用：独立连接发现机制。
- 客户端确实需要原生工具发现：再提供机器可读 schema 或 MCP。

这些不作为第一版完成前置条件。
