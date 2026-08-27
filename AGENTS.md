# CMUX Agent Remote

Mac 本地的多 Agent Web 控制中心：通过浏览器 / 手机查看并控制 cmux 里的 Claude Code、Codex CLI、Grok Build。不是远程 Terminal，核心是「谁在干活、谁在等你」。用法与 API 以 README.md 为准。

## 怎么跑

需要 Bun。长驻服务放 tmux，不要前台占终端。

```bash
bun install && bun run build
bun run start                 # 127.0.0.1:4318
bun run start -- --lan        # 同一 Wi-Fi 手机可访问
bun run start -- --demo       # 没有 cmux 时用假数据
bun run test                  # Vitest
bun run typecheck             # tsc -b
bun run dev                   # 服务端 watch
bun run dev:web               # 前端 :4319，代理到 :4318
```

数据目录默认 `~/.cmux-agent-remote/`（PIN / session / hook 配置）。Hook：`bun run install-hooks`。要挂公网先读 `docs/公网暴露指南.md`。

技术栈：Bun + Hono + SQLite / React 18 + Vite / Zod；bun workspaces。

## 目录

```
apps/server/src/   cmux/ hooks/ state/ realtime/ api/ security/
apps/web/src/      pages/ components/ hooks/ stores/
packages/protocol  共享 Zod schema（前后端）
packages/shared    时间、缓存、文本清洗
scripts/           cmux-agent-web-hook + 安装/卸载
```

## 约定

- 写操作必须带 `surfaceId`。默认只读；控制模式 15 分钟无操作回落，重启后一律只读。
- 人用短 PIN，Hook 用长密钥且只收本机回环；Hook 任何失败都必须 exit 0。
- 调 cmux 走参数数组，不经过 shell。SQLite 不存终端全文和 prompt。
- 路由：`#/` 结构树首页，`#/s/:id` 会话，`#/w/:id` 单 workspace 深链。不要把首页改回独立 Inbox。
- 会话页终端走 `cmux rpc terminal.replay` 网格，不要退回纯 `read-screen`。
- 回看历史分两条路，别混：普通屏用 `read-screen --scrollback`（`/history`，纯文本、不进 SnapshotTracker），
  全屏 TUI 只能发 `pageup` 让它自己翻（`/scroll`，只读模式放行，离开会话自动 `bottom` 复位）。
  `terminal.replay` 只吃 `surface_id`，回滚 240 行封顶，别再找参数了。
- 别再找「按行滚动 / 转发滚轮」的 cmux 接口：`terminal.scroll`、`terminal.mouse` 实测是空壳
  （不校验参数、画面不动）。TUI 只能整屏翻，前端用手势（`usePageGesture`）包装成翻页。
- 新建 surface 只建 terminal，`--type agent-session` 是死路（读不到画面也发不了输入）。
  起 Agent 走服务端白名单命令（`config.launchCommands`），不收前端传的命令字符串。
  新 tab 懒启动，建完必须发一次回车唤醒，否则没有 tty、读画面直接报错；
  工作目录 cmux 不给，只能 `lsof` 反查同 pane 进程的 cwd。

## 当前状态（2026-08-24）

v0.1.0，第一版可用。远端 `gitlab.vivix.work/Link/Agent-Remote`，分支 `main`。无生产部署。原始需求在 `docs/CMUX Agent Remote — 产品与技术需求文档.md`，已落地差异以 README 为准。未做：完整 Terminal Emulator、多用户、云端 Relay、tmux 长任务、Project 聚合。
