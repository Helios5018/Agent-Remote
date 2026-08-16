# CMUX Agent Remote

> 运行在 Mac 上、通过 Web 和手机远程查看与控制 Claude Code、Codex 和 Grok Build 的多 Agent Control Center。

它的核心不是远程 Terminal，而是：**随时知道哪个 Agent 在做什么、哪个 Agent 在等你，并能够立即接手。**

```text
Agent → cmux Surface → Mac 本地 Bridge → Web → 手机
```

---

## 快速开始

```bash
# 1. 安装依赖（需要 Bun）
bun install

# 2. 构建前端
bun run build

# 3. 启动
bun run start                 # http://127.0.0.1:4318
bun run start -- --lan        # 同一 Wi-Fi 下手机可访问

# 4.（可选）安装三家 Agent 的 Hook，获得精确状态
bun run install-hooks         # 卸载：bun run uninstall-hooks
```

启动后终端会打印：

```text
  CMUX Agent Remote

  Local:        http://localhost:4318
  Network:      http://192.168.x.x:4318     # 仅 --lan 时

  Access Token: XXXXXXXXXXXX
```

浏览器首次访问输入这个 Token，之后换成 Session Cookie。Token 首次生成后会保存在
`~/.cmux-agent-remote/state.db`，重启复用；`--rotate-token` 可以换一个新的并踢掉所有已登录设备。

没有 cmux 的环境可以用 `bun run start -- --demo` 跑内置假数据。

---

## 三个页面

| 页面 | 作用 |
|------|------|
| **Attention Inbox**（`#/`） | 首页。先回答「哪些 Agent 现在需要我」，按注意力优先级排序 |
| **Workspace**（`#/w/all`） | cmux 真实结构 Workspace → Pane → Surface，回答「这个 Agent 在哪个 surface」 |
| **Agent 会话**（`#/s/:surfaceId`） | 使用频率最高：看最近输出、发 Prompt、发控制键 |

首页排序：

```text
ERROR → NEEDS_APPROVAL → NEEDS_INPUT → RESPONDED_UNREAD → POSSIBLY_STALE → WORKING → IDLE
```

---

## 架构

```text
        Mobile Web / PWA
              │  HTTP / WebSocket
              ▼
┌──────────────────────────────────────┐
│      CMUX Agent Remote Server        │
│  Web API │ WebSocket │ Hook Receiver │
│         ┌──────────────┐             │
│         │ State Engine │             │
│         └──────────────┘             │
│   ▲                        ▲         │
│ cmux Adapter          Hook Adapter   │
└───┼────────────────────────┼─────────┘
    ▼                        │
 cmux CLI/Socket        Agent Hooks（claude / codex / grok）
```

三条数据来源在 State Engine 汇合：

| 来源 | 负责 |
|------|------|
| **cmux** | Workspace / Pane / Surface / Agent 进程 / PID / 终端内容 / 控制 |
| **Agent Hooks** | 语义状态：开始回合、调用工具、需要批准、需要输入、回合结束、失败 |
| **时间与进程** | 进程是否还在、状态是否过期、多久没有新输出 |

### 模块

```text
apps/server/src/
├── cmux/        眼睛和手：client(接口) / cli-client(CLI 实现) / discovery / output / control
├── hooks/       三家 Agent 事件 → 统一 AgentEvent
├── state/       store(SQLite) / engine(大脑) / stale(时间规则)
├── realtime/    hub(运行时无关) / poller(分级刷新) / websocket(Bun 绑定)
├── api/         agents / workspaces / surfaces / hooks / auth
└── security/    token / session / control mode / 中间件

apps/web/src/    React + Vite，移动优先，无第三方路由与状态库
packages/protocol/  Zod schema + 类型（前后端共享）
packages/shared/    时间、终端文本清洗、缓存等纯函数
scripts/         cmux-agent-web-hook（真正跑在 Agent 里的 shell）+ 安装/卸载
```

`CmuxClient` 是接口，第一版用 cmux CLI 实现，后续可切到 Unix Socket，上层业务无感。

---

## 状态模型

| 状态 | 含义 | UI |
|------|------|----|
| `WORKING` | 正在执行一个 Turn | ● Working |
| `NEEDS_APPROVAL` | 等待用户批准某个操作 | ⚠ Needs approval |
| `NEEDS_INPUT` | Agent 在向用户提问 | ⚠ Needs input |
| `RESPONDED_UNREAD` | 回合结束但用户还没看 | ◇ Responded |
| `IDLE` | 还在跑，但当前没工作 | ○ Idle |
| `POSSIBLY_STALE` | 标记为 Working 但长时间没动静（默认 10 分钟） | △ Possibly stale |
| `ERROR` | Agent 或 Hook 明确异常 | ✕ Error |
| `CLOSED` | 进程已退出 | · Closed |

没装 Hook 时系统仍然可用：靠输出变化推断 Working / Responded，但精度不如 Hook。

---

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/auth/login` | Token 换 Session Cookie |
| `GET` | `/api/auth/session` | 当前登录态与控制模式 |
| `POST` | `/api/auth/control` | 开启 / 关闭控制模式 |
| `GET` | `/api/agents` | Attention Inbox（分组 + 汇总） |
| `GET` | `/api/agents/:surfaceId` | Agent 详情 + 输出快照（并标记已读） |
| `POST` | `/api/agents/:surfaceId/read` | 显式标记已读 |
| `GET` | `/api/tree` | cmux 完整结构 |
| `GET` | `/api/surfaces/:surfaceId/output` | 读取输出 |
| `POST` | `/api/surfaces/:surfaceId/input` | `{ text, submit }` 输入内容 |
| `POST` | `/api/surfaces/:surfaceId/key` | `{ key, confirm }` 发送按键 |
| `POST` | `/api/hooks/:agent` | Hook 上报（共享 token，非浏览器 Session） |
| `GET` | `/api/audit` | 最近的写操作审计 |

允许的按键：`enter` `escape` `tab` `up` `down` `ctrl+c`。

WebSocket `/ws`：

```jsonc
// 客户端 → 服务端
{ "type": "subscribe", "surfaceId": "…" }
{ "type": "ping" }

// 服务端 → 客户端
{ "type": "agent.status_changed", "surfaceId": "…", "status": "needs_approval", "agent": { … } }
{ "type": "agent.list_changed", "inbox": { … } }
{ "type": "surface.snapshot", "surfaceId": "…", "revision": 128, "content": "…" }
```

---

## 安全

这个系统本质上拥有远程控制终端的能力，所以第一版就做了：

- **Access Token**：首次访问输入，之后换 HttpOnly Session Cookie。
- **默认只读**：写操作必须显式开启 Control Mode，15 分钟无操作自动回到只读；重启后一律回到只读。
- **所有写操作必须指定 surface**：不存在 "send to current terminal"，服务端强制校验。
- **危险操作二次确认**：`Ctrl+C` 未带 `confirm` 返回 `428`。
- **防注入**：所有 cmux 调用走参数数组 + `--`，不经过 shell。
- **不保存终端内容**：SQLite 只存状态 / 时间 / Session / 未读 / 配置 / 审计；
  审计只记录 `len=… submit=…`，不落 prompt 原文。
- **Hook 失效不影响 Agent**：Hook 接口永远返回 200，hook 脚本任何情况下 exit 0 且 stdout 为空。

默认只监听 `127.0.0.1`，`--lan` 才对局域网开放。

---

## 刷新策略

| 场景 | 间隔 |
|------|------|
| 用户正在查看的 surface | 400ms |
| Working / 等待用户的 Agent | 1s |
| Idle（无 Hook） | 8s |
| Idle（有 Hook 托底）且无人查看 | 不轮询 |

内容指纹没变化就不推送给浏览器；`tree` / `top` 带 1s TTL 缓存与 single-flight 合并。

---

## Hook

三家 Agent 的用户级 hook 最终都调用同一个脚本：

```bash
scripts/cmux-agent-web-hook <claude|codex|grok> <NativeEventName>
```

| Agent | 配置文件 | 挂载事件 |
|-------|----------|----------|
| Claude Code | `~/.claude/settings.json` | SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Notification / Stop / SessionEnd |
| Codex CLI | `~/.codex/hooks.json` | SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / PermissionRequest / Stop |
| Grok Build | `~/.grok/hooks/cmux-agent-remote.json` | SessionStart / UserPromptSubmit / PreToolUse / Notification / Stop / SessionEnd |

安装器会先备份成带时间戳的 `.bak`，只合并自己的条目，卸载时也只删自己的（cmux 自带的 hook 不受影响）。
脚本从 `~/.cmux-agent-remote/hook.json` 读取端口与 token（服务启动时自动写入）。

Hook 与 surface 的关联顺序：`CMUX_SURFACE_ID` → pid 反查 cmux 进程树 → sessionId → workspace + agent 类型唯一命中。

---

## 开发

```bash
bun run test          # Vitest，165 个用例
bun run typecheck     # tsc --noEmit
bun run dev           # 服务端（watch）
bun run dev:web       # 前端 dev server（:4319，代理到 :4318）
```

第一版不使用 xterm.js，输出以纯文本 `pre` 渲染 —— 手机阅读体验更好。
