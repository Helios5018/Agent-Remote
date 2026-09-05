# cmux

### 新建 surface

首页每个 pane 底部有「＋ 新建 surface」，可以选 Shell / Claude / Codex / Grok / Pi，
建完直接跳进会话页（Mac 上不会抢焦点）。三条约束：

- **只建 terminal**。`cmux new-surface --type agent-session` 建出来的是 cmux 自己的
  Agent 面板，`read-screen` 报 "Surface is not a terminal"、`terminal.replay` 直接
  not_found —— 在这边既看不到画面也发不了输入。要新开一个 Agent，就是建 terminal 再敲命令。
- **`launch` 是白名单枚举，不是命令字符串**。收任意命令等于在公网上送一个远程 shell。
  实际执行的命令在服务端配置：默认 `c-d` / `codex-d` / `g-d` / `pi`（前三个通常是
  `~/.zshrc` 里带跳过确认参数的别名，手机上没法一路点确认），可用 `CAR_LAUNCH_CLAUDE` /
  `CAR_LAUNCH_CODEX` / `CAR_LAUNCH_GROK` / `CAR_LAUNCH_PI` 覆盖。
- **`paneId` 必填且要真实存在**。写操作一律显式指定目标，服务端不认「当前 pane」。

首页每一行右边有 ×，点两次确认后走 `cmux close-surface`，关的是 Mac 上那个真实 tab
（里面的 Agent / shell 一起没）。这不是前端列表过滤。cmux **不允许关掉一个 workspace
里最后一个 surface**；那种情况按钮是灰的。分屏里最后一个 tab 可以关，关完那个 pane 会消失。

两个 cmux 侧的坑已经在 adapter 里处理掉了：新 tab 是**懒启动**的，没被激活过就没有 tty，
读画面会报 `internal_error: Failed to read terminal text` —— 所以建完先发一次回车把 shell
拉起来（回车最干净，`escape` 会在终端里留个 `^[`）；工作目录 `tree` / `top` 都不给，
只能从同 pane 已有进程用 `lsof` 反查 cwd，查不到就不传，由 cmux 用默认目录。

### 终端画面怎么还原的

`cmux read-screen` 的定义是 "as **plain text**" —— 颜色、粗体、反显、光标、以及
「每个字符占几格」在那一层就没了，所以纯文本永远补不回 TUI 的样子（中文占 2 格，
浏览器 fallback 字体未必正好 2 倍宽，逐行累积就把边框冲断了）。

会话页改成读 `cmux rpc terminal.replay`（`cmux.render-grid.v1`）：

| 字段 | 用途 |
|------|------|
| `row_spans[].cell_width` | 终端真实格子数，前端按它定位，不依赖字体度量 |
| `styles[]` | 已解析成 `#rrggbb` 的前景 / 背景 + 粗体 / 淡色 / 斜体 / 下划线 / 反显 / 删除线 |
| `cursor` | 光标行列与可见性 |
| `active_screen` | primary / alternate，用来区分全屏 TUI |
| `scrollback_spans` | 视口之上的回滚（cmux 固定给最近 240 行） |

服务端会做紧凑化（样式抽表、span 用数组元组、丢掉无意义的空白段），111×62 的一屏
从 69 KB 压到 20 KB，加上 gzip 实测 **约 5 KB/帧**；内容指纹没变则完全不推送。

**宽度自适应**：cmux 不允许第三方客户端改终端列数（`terminal.viewport` 只读，
`mobile.terminal.set_font` 只发给 cmux 自家移动端），所以在展示层适配：

- 全屏 TUI → 整屏等比缩放到容器宽度，边框严格对齐
- 普通输出 → 按容器宽度软换行，手机上正常读
- 会话页右下角可在 `自动 / 缩放 / 换行` 之间切换，选择会记住
- `A− / A+` 调字号；TUI 下它是**缩放倍数**（1.0 = 正好铺满屏宽）。120 列铺满 iPhone
  屏宽只有 5 px 高，根本读不了，所以允许放大到看得清，代价是横向滑动看完一行
- `⤢ 沉浸` 收起标题栏和输入区（输入区变成一条，点开才展开），把屏幕都留给终端

只有**正在查看**的 surface 读网格；后台状态推断仍走便宜的纯文本。

### 怎么往回看

一屏只有 62 行，往回翻这件事分两种情况，因为 cmux 那一层给的东西就不一样：

| | 普通屏（shell、Codex CLI…） | 全屏 TUI（Claude Code、Grok…） |
|---|---|---|
| `terminal.replay` | 回滚固定给最近 **240 行** | `scrollback_rows` 恒为 **0** |
| `read-screen --scrollback` | 能拿到**全部** history（实测 1069 行） | 仍然只有当前一屏 |
| 怎么回看更早 | 「加载更早的历史」按钮 | 「▲ 上一屏」让 TUI 自己翻 |

- **普通屏**：正常往上滚，滚到头**自动**把更早的历史接上（也可以点那颗按钮）。
  这一段没有颜色 —— cmux 在 plain text 那一层就把样式丢了；插入时会补回等高的
  滚动量，视线不会跳。它走独立的 `readHistory`，**不进 SnapshotTracker**：
  一次性把上千行灌进快照，「输出有没有变化」的判断会全乱。
- **全屏 TUI**：历史在程序自己手里，终端一行 scrollback 都没有，只能发 `pageup`
  让它重画更早的一屏。所以翻页按钮**只在 TUI 会话显示** —— 普通屏里跑的 CLI
  未必理会 `pageup`，摆个点了不动的按钮更糟。
  代价是这会同步滚动 Mac 上那块真实画面，所以离开会话时自动发一次 `bottom` 复位。

**翻页手势**：TUI 会话不用去够按钮 —— 滑到边界继续滑就翻页。手指拖动时画面跟手位移
（带阻尼，上限 96px），拖过 64px 顶部出现「松手看上一屏」，松手才真的翻；桌面滚轮累计
110px 触发一次，中途换方向立刻清零。两次翻页之间至少隔 280ms，免得惯性滚动把 TUI 冲过头。

为什么是「翻一屏」而不是跟手连续滚动：cmux 没有按行滚动的接口。`terminal.replay` 只吃
`surface_id`，`terminal.scroll` / `terminal.mouse` 这两个未公开方法实测是空壳（不校验参数、
画面纹丝不动），滚轮事件也转发不过去。能用的只有 `pageup` / `pagedown` 两个按键，
所以这里把整屏跳变包装成翻页手势 —— 至少让「跳了一屏」是用户自己按出来的。


