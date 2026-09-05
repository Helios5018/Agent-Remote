# 开发与验证

仓库使用 Bun workspaces，前端 Vite、后端 Bun/Hono，跨端合同位于 packages/protocol。

## 开发服务

在仓库根目录执行。若 4318 已运行，复用该 API 服务，只启动前端即可。

```bash
# API watch：4318
tmux new-session -d -s agent-remote-api-dev 'bun run dev'
# Web：4319，代理 API 到 4318
tmux new-session -d -s agent-remote-web-dev 'bun run dev:web'
# 日志
tmux capture-pane -pt agent-remote-web-dev -S -80
tmux capture-pane -pt agent-remote-api-dev -S -80
# 停止自己启动的开发服务
tmux kill-session -t agent-remote-web-dev
tmux kill-session -t agent-remote-api-dev
```

## 门禁

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
```

TypeScript 覆盖前后端源码、前后端测试、共享包与 scripts。Vitest 运行服务端 API/状态/Hook 测试及前端连接生命周期、缓存和交互规则测试。构建输出 apps/web/dist，被启动服务读取；运行中更新按公网指南执行。

前端拆分应验证登录、树展开/筛选、打开会话、发送失败保留文本、关闭最后一个 tab、普通历史和 TUI 翻页。浏览器验收使用 Playwright；真实 cmux 写操作应使用隔离测试会话。

## 文件归属

功能组件放 features；真正复用的 UI 放 components。高频网格不进入全局 React Context。HTTP 路由处理参数与响应，终端业务流程放 services，cmux 命令细节留在 adapter。测试通过后再发布，不能把 build 成功当成线上验收。
