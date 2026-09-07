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

## 按需文件浏览器

Agent 详情页默认不显示文件页签。在右上角「⋯」选择「打开文件系统」后，出现「会话 / 文件」并进入文件页。文件页「⋯」或详情页「⋯」都可以关闭模块，关闭不会删除文件。是否打开按 Agent 在当前浏览器中记忆；目录标签、选中项、滚动位置和复制队列在各 Agent 之间共享。

- 默认仅显示一行目录导航；路径以 `~/…` 面包屑常驻显示，长路径可横向滑动，默认露出末尾，点击上级目录返回；点击搜索展开搜索框，新建、刷新和隐藏项等收进「⋯」。多个目录标签时才展示标签栏，手机在文件列表左右滑动切换。
- 长按或菜单「选择文件」进入多选，选中时才显示复选框和操作栏。桌面提供列表 / 预览双栏，手机预览覆盖列表；切回会话默认回到最新输出底部。
- 当前目录筛选、递归文件名搜索、文本内容搜索；每页 100 项，点击底部加载更多。
- 文本、代码、Markdown 源文和图片预览；复制地址、新建文件 / 文件夹、重命名、多选复制粘贴。冲突拒绝覆盖，请改名后重试。
- 初次打开尝试使用当前 Agent 的工作目录；获取失败时回到主目录。文件菜单可随时转到当前 Agent 工作目录。

文件浏览器可访问整台 Mac 的文件系统，不限制在项目或 Agent 工作目录内；实际读写权限由运行服务的 macOS 用户决定。所有文件接口仍需登录。菜单提供主目录 `~` 快捷入口。文件模块不依赖 cmux，会话只是入口。

文本预览上限 128 KB；内容搜索检查 128 KB 内的文本，跳过 `.git` / `node_modules`，最多扫描 20000 项或 5 秒，可取消。图片预览和下载上限 20 MB。单次复制最多 100 个选中项、递归 10000 项或 512 MB，软链接和特殊文件不参与复制。复制失败会提示已完成数量，目标目录可能保留部分内容；刷新后检查。当前不提供删除、移动或正文编辑。
