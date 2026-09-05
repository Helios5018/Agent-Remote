## 页面

| 页面 | 作用 |
|------|------|
| **首页**（`#/`） | 按 cmux 结构展开的 Agent 总览 |
| **单 Workspace**（`#/w/:workspaceId`） | 首页的深链，只展开某一个 workspace（`#/w/all` 等于首页） |
| **Agent 会话**（`#/s/:surfaceId`） | 使用频率最高：看画面、往回翻历史、发 Prompt、发控制键 |

首页直接按 cmux 的真实层级渲染：

```text
Workspace ── Pane ── Surface ── Agent
```

- 点 workspace / pane 标题折叠或展开；工具条上的「全部折叠 / 全部展开」一键处理
- 「只看 Agent ⇄ 全部 surface」切换是否显示 shell、编辑器等非 Agent 的 surface
- 搜索框按 workspace / surface 名过滤，搜索时自动展开命中项
- 折叠状态、筛选条件存在 localStorage，刷新和重连都不会丢
- 折叠的 workspace 标题上仍会显示 `2 需要你` / `1 运行中` / `+3`（被隐藏的 surface 数）
- 非 Agent 的 surface 也能点开查看输出、发输入

标题一律 **surface 名为主、workspace 名为辅**（`▤ workspace`）—— surface 名才是你在 cmux
标签上看到的那行字。

「哪些 Agent 现在需要我」不再单独占一个视图：顶栏汇总（`2 需要你 · 1 运行中 · 5 空闲`）和
workspace 标题上的角标已经把这件事说清楚了。服务端仍然按注意力优先级排序，
`GET /api/agents` 返回的分组顺序是：

```text
ERROR → NEEDS_APPROVAL → NEEDS_INPUT → RESPONDED_UNREAD → POSSIBLY_STALE → WORKING → IDLE
```
