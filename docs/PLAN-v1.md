# CMUX Agent Remote 第一版实现计划

## 核心思路

按需求文档 §21 的目录结构，用 Bun + Hono + React/Vite + TypeScript 搭一个 monorepo，把链路
`Agent → cmux Surface → Bridge(Server) → Web → 手机` 完整打通。三条数据流独立收敛到 State Engine：

1. **cmux Adapter（眼睛和手）**：封装 `CmuxClient` 接口，第一版用 `cmux` CLI 实现
   （`tree --all --json --id-format both` 拿拓扑、`top --all --processes --json` 做 Agent 进程发现、
   `read-screen --json` 读输出、`send` / `send-key` 做控制）。接口与实现分离，后续可无感切到 Unix Socket。
2. **Hook Adapter（语义状态）**：Claude Code / Codex CLI / Grok Build 三家 hook 格式都是
   `hooks.json`（event → command）结构，统一由 `cmux-agent-web-hook` 脚本 POST 到
   `/api/hooks/:agent`；服务端三个 adapter 把原生事件翻译成统一 `AgentEvent`。
   Hook 失败必须静默退出 0，绝不阻塞 Agent 本身。
3. **State Engine（大脑）**：融合 cmux 拓扑 + Hook 事件 + 进程存活 + 输出变化 + 用户已读时间，
   计算统一 `AgentStatus`（WORKING / NEEDS_APPROVAL / NEEDS_INPUT / RESPONDED_UNREAD / IDLE /
   POSSIBLY_STALE / ERROR / CLOSED），并按 Attention Priority 排序输出给首页 Inbox。

实时层用 WebSocket + 自适应轮询（正在查看 400ms / Working 1s / Idle 8s / 不可见不轮询），
内容无变化不推送。安全上默认只读，Token 登录换 Session Cookie，控制模式需显式开启且会超时回落，
所有写操作必须显式带 surfaceId，Ctrl+C 等危险键前端二次确认、服务端记审计。

## 改动范围

新建目录 `cmux-agent-remote/`（本任务目录下），全部为新增文件：

- `packages/protocol/` — Zod schema + TS 类型（AgentEvent / AgentState / CmuxTree / WS 消息 / API 契约）
- `packages/shared/` — 时间、排序、日志等纯函数工具
- `apps/server/src/cmux/` — `client.ts`(接口) `cli-client.ts`(CLI 实现) `discovery.ts` `output.ts` `control.ts`
- `apps/server/src/hooks/` — `claude.ts` `codex.ts` `grok.ts` + 统一入口
- `apps/server/src/state/` — `store.ts`(SQLite) `engine.ts` `stale.ts`
- `apps/server/src/realtime/` — `websocket.ts` `poller.ts`
- `apps/server/src/api/` — `agents.ts` `workspaces.ts` `surfaces.ts` `hooks.ts` `auth.ts`
- `apps/server/src/security/` — token / session / control-mode / audit
- `apps/web/src/` — `pages/`(Inbox, Workspace, Session, Login) `components/` `hooks/` `stores/`
- `scripts/` — `install-hooks.ts` `uninstall-hooks.ts` `cmux-agent-web-hook`
- 测试：Vitest，覆盖 protocol / cmux 解析 / discovery / 三个 hook adapter / state engine / API / 安全 / installer

外部文件**不主动修改**：`~/.claude/settings.json`、`~/.codex/hooks.json`、`~/.grok/hooks/` 只由
`install-hooks` 在用户显式执行时写入，测试全部在临时 HOME 沙箱里跑。

## 影响评估

- **对现有 cmux / Agent 的影响**：只读命令（tree/top/read-screen）无副作用；写命令（send/send-key）
  必须显式指定 surface，不会误伤其他 Agent。默认只读模式进一步降低误操作风险。
- **Hook 安装风险**：会修改用户级 Agent 配置。缓解：安装前自动生成时间戳 `.bak`，写入内容带
  `cmux-agent-remote` 标记，`uninstall-hooks` 可精确移除；本次任务只在临时 HOME 中验证，
  不动用户真实配置（需要时由用户一条命令自行开启）。
- **端口占用**：默认 `127.0.0.1:4318`，`--host 0.0.0.0` 才对局域网开放；开放时强制 Token。
- **性能**：轮询全部 surface 会有 CLI 进程开销，故采用分级轮询 + 只对可见/Working surface 高频读取，
  并对 `tree`/`top` 做 TTL 缓存与单飞（single-flight）合并。
- **数据留存**：SQLite 只存状态/时间/session/未读/配置/审计，**不存**终端全文与对话内容（§23.5）。
- **e2e 测试副作用**：会临时新建一个 cmux workspace 跑 shell 做真实回环验证，测试结束即关闭。

## 计划文件路径

/Users/link/AgentWork/Tasks/20260817-Agent-Remote/docs/PLAN-v1.md
