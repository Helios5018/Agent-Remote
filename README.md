# CMUX Agent Remote

运行在 Mac 上的多 Agent Web 控制中心，通过浏览器和手机查看、控制 cmux 中的 Claude、Codex、Grok 和 Pi。核心是及时知道谁在工作、谁在等你，并能立即接手。

```text
Agent → cmux Surface → 本地 Bridge → Web / 手机
```

## 快速开始

需要 Bun 和 cmux。长驻服务放在 tmux 中运行：

```bash
bun install
bun run build
tmux new-session -d -s agent-remote-web 'bun run start'
```

默认访问 `http://127.0.0.1:4318`，首次输入服务日志中的 Access PIN。

```bash
# 查看日志（包含首次登录 PIN）
tmux capture-pane -pt agent-remote-web -S -80
# 停止服务
tmux kill-session -t agent-remote-web
# 可选：安装 Agent Hook，获取更精确的状态
bun run install-hooks
```

启动参数：`--lan` 开放局域网、`--demo` 使用假数据、`--rotate-pin` 轮换 PIN、`--unlock` 清除登录锁定。持久化数据默认在 `~/.cmux-agent-remote/`。

已有服务优先复用端口和 tmux session。公网更新见 [公网暴露指南](docs/公网暴露指南.md)，不要为了更新代码重建隧道。

## 页面

| 地址 | 用途 |
|---|---|
| `#/` | 按 Workspace → Pane → Surface 展开的首页 |
| `#/w/:id` | 单 workspace 深链 |
| `#/s/:id` | 终端画面、历史、输入和控制键 |

支持搜索、折叠、只看 Agent、新建/关闭 surface、改名、缩放和沉浸显示。Pi 会话提供 Ctrl+P 切换模型。详见 [使用说明](docs/usage.md)。

## 项目结构

```text
apps/server/src/   api、services、cmux、hooks、state、realtime、security
apps/web/src/      pages、features、components、stores、hooks、realtime、styles
packages/protocol/ 跨端 Zod schema、状态分组和类型
packages/shared/   跨端纯函数
scripts/           Hook 安装与卸载
```

## 开发与验证

```bash
bun run typecheck
bun run test
bun run build
```

开发服务也需放 tmux，详情见 [开发指南](docs/development.md)。自动化测试通过不代表真实 cmux 与公网已验收。

## 文档导航

| 文档 | 内容 |
|---|---|
| [架构与状态流](docs/architecture.md) | 模块边界、数据来源、状态和刷新策略 |
| [API 合同](docs/api.md) | HTTP 与 WebSocket |
| [cmux 集成](docs/cmux-integration.md) | 网格、历史、翻页、启动限制 |
| [Hook 接入](docs/hooks.md) | 各 Agent 的配置与事件 |
| [认证与数据边界](docs/security.md) | PIN、限流、持久化约束 |
| [公网运维](docs/公网暴露指南.md) | Sealtun 原地更新、启停和排障 |
| [整理与迭代建议](docs/项目整理与迭代建议.md) | 审查依据、实施批次与后续方向 |

[原始需求](<docs/archive/CMUX Agent Remote — 产品与技术需求文档.md>) 和 [第一版验收](docs/archive/验收报告.md) 保留在 archive，属于历史记录。
