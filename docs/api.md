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
