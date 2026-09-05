> 历史记录：保留当时设计与验收结果。当前行为以 [README](../../README.md) 和现役文档为准。

# CMUX Agent Remote — 产品与技术需求文档

> **现役对照（2026-08-24）**：本文是立项需求，不是运行手册。用法与实现以 [README.md](../README.md) 为准。已落地但与原文不同的几处：首页是 cmux 结构树（注意力走顶栏汇总，不再单独 Inbox 页）；鉴权是 4 位 PIN + 限流，不是长 Token；会话页终端走 `cmux rpc terminal.replay` 网格。

## 1. 产品概述

### 1.1 产品定位

CMUX Agent Remote 是一个运行在 Mac 本地的 Web 控制台，用于统一查看和远程控制运行在 cmux 中的 AI Coding Agent。

第一阶段支持：

- Claude Code
- Codex CLI
- Grok Build

用户可以通过电脑浏览器或手机浏览器访问 Web 页面，查看所有正在运行的 Agent、Agent 当前状态、终端输出，并直接向指定 Agent 输入新的 Prompt 或发送控制按键。

核心目标不是做一个“网页版 Terminal”，而是做一个：

> **面向多 Agent 工作流的移动端控制中心。**

---

## 2. 用户场景

典型工作方式：

```text
MacBook
│
├── cmux
│   ├── Workspace A
│   │   ├── Surface → Codex
│   │   └── Surface → Claude
│   │
│   └── Workspace B
│       └── Surface → Grok
│
└── CMUX Agent Remote
```

用户可能同时运行 5～20 个 Agent。

当前问题是：

1. 不知道哪个 Agent 正在工作。
2. 不知道哪个 Agent 已经回复。
3. 不知道哪个 Agent 正在等待输入或权限批准。
4. 必须不断切换 cmux workspace 才能查看。
5. 人离开电脑以后无法方便地继续控制 Agent。
6. 手机远程桌面操作 cmux 的体验很差。

CMUX Agent Remote 要解决的是：

```text
打开手机
    ↓
看到哪些 Agent 需要我
    ↓
查看 Agent 输出
    ↓
直接回复 Agent
    ↓
Agent 继续工作
```

---

# 3. 产品目标

## 3.1 第一阶段目标

实现完整链路：

```text
Agent
  ↓
cmux Surface
  ↓
Mac 本地 Bridge
  ↓
Web
  ↓
手机
```

用户需要能够：

- 查看所有 cmux Workspace。
- 查看 Workspace 内 Pane / Surface。
- 知道 Surface 中是否运行 Agent。
- 知道 Agent 类型。
- 查看 Agent 当前状态。
- 查看 Agent 最近输出。
- 向 Agent 输入 Prompt。
- 发送基础控制键。
- 快速发现“需要用户处理”的 Agent。
- 手机端正常使用。

---

## 3.2 非目标

第一版不做：

- 完整 Terminal Emulator。
- VS Code / 文件编辑器。
- 自动批准 Agent 的危险操作。
- Agent 自动互相通信。
- Agent 自动任务编排。
- 多用户协作。
- SaaS。
- 多台 Mac 管理。
- 云端保存 Agent 对话。
- 完整 Git Review 系统。
- tmux 长任务管理。

tmux、Project 聚合等能力放到后续版本。

---

# 4. 产品信息架构

cmux 的实际结构：

```text
Workspace
└── Pane
    └── Surface
        └── Agent Process
```

系统内部需要完整保存这个层级。

但手机 UI 不应该默认展示所有技术结构。

---

# 5. 核心页面

## 5.1 首页：Attention Inbox

首页不是简单列出所有终端，而是优先告诉用户：

> 哪些 Agent 现在需要我？

示例：

```text
Agents

NEEDS YOU

⚠ 世界模型 Demo
  Codex
  Waiting for approval
  18s ago

◇ 业务评测平台
  Claude
  Responded · unread
  2m ago


WORKING

● P02 Evaluation
  Grok
  Running command
  4m


IDLE

○ Homepage
  Codex
  Idle
```

默认排序：

```text
ERROR
↓
NEEDS_APPROVAL
↓
NEEDS_INPUT
↓
RESPONDED_UNREAD
↓
POSSIBLY_STALE
↓
WORKING
↓
IDLE
```

顶部显示汇总：

```text
2 Need You · 3 Working · 1 Error · 4 Idle
```

---

# 6. Workspace 页面

用户可以进入某个 Workspace 查看真实 cmux 结构。

示例：

```text
世界模型 Demo

▼ pane:7

  ○ surface:10
    Codex
    Idle

  ● surface:11
    Codex
    Working
    Running tests

▼ pane:8

  surface:12
  Shell
```

这里主要解决：

> 这个 Agent 实际位于哪个 cmux Surface？

---

# 7. Agent 会话页面

这是用户使用频率最高的页面。

结构：

```text
世界模型 Demo

Codex
● Working

surface:11
Running 4m 32s

────────────────────

Running pnpm test...

14 tests passed
2 tests failed

I found that evaluation_type
is missing from the import mapping.

────────────────────

[ 输入消息……                  ]

[ Send ]

[Enter] [Esc] [Tab] [Ctrl+C]
```

支持：

- 查看最近输出。
- 自动刷新输出。
- 输入普通 Prompt。
- 一键发送并 Enter。
- Escape。
- Tab。
- Ctrl+C。
- 手动刷新。
- 查看 Agent 当前状态。
- 查看最后状态更新时间。

---

# 8. Agent 状态模型

三个 Agent 的原始 Hook 不同，但系统内部全部统一。

统一状态：

```text
WORKING
NEEDS_APPROVAL
NEEDS_INPUT
RESPONDED_UNREAD
IDLE
POSSIBLY_STALE
ERROR
CLOSED
```

---

## 8.1 WORKING

表示当前 Agent 正在执行一个 Turn。

来源可能包括：

- 用户提交 Prompt。
- Agent 调用工具。
- Agent 输出持续变化。

UI：

```text
● Working
```

---

## 8.2 NEEDS_APPROVAL

Agent 当前正在等待用户批准某个操作。

UI：

```text
⚠ Needs approval
```

优先级很高。

第一版点击后进入 Agent 页面。

不直接在首页自动批准。

---

## 8.3 NEEDS_INPUT

Agent 主动向用户提问，需要用户回答。

例如：

```text
Which implementation should I use?
```

UI：

```text
⚠ Needs input
```

---

## 8.4 RESPONDED_UNREAD

Agent 当前 Turn 已经结束，但用户尚未查看最新结果。

UI：

```text
◇ Responded
```

用户打开该会话以后：

```text
RESPONDED_UNREAD
→ IDLE
```

---

## 8.5 IDLE

Agent 仍然运行，但当前没有工作。

---

## 8.6 POSSIBLY_STALE

Agent 被标记为 Working，但：

- 长时间没有 Hook。
- 输出没有变化。
- 进程仍然存在。

例如超过 10 分钟：

```text
△ Possibly stale
No activity for 12m
```

这里只提示，不自动认为 Agent 已卡死。

---

## 8.7 ERROR

表示 Agent 或 Hook 出现明确异常。

例如：

- Agent Turn Failure。
- CLI 异常退出。
- API 错误。

---

## 8.8 CLOSED

对应 Agent 进程已经退出。

---

# 9. 状态数据来源

状态不能只来自一个地方。

系统需要合并三种数据。

## A. cmux

负责：

```text
Workspace
Pane
Surface
Agent Process
PID
终端内容
```

## B. Agent Hooks

负责：

```text
开始 Turn
执行工具
需要批准
需要输入
Turn 完成
失败
Session 结束
```

## C. 时间 / 进程检测

负责：

```text
进程是否还存在
状态是否过期
多久没有新输出
```

最终状态由 State Engine 统一判断。

---

# 10. Hook 设计

Claude Code、Codex CLI、Grok Build 分别配置用户级 Hook。

它们最终全部调用：

```text
cmux-agent-web-hook
```

数据流：

```text
Claude
Codex
Grok
   ↓
Agent Hook Adapter
   ↓
Normalized Event
   ↓
State Engine
```

统一事件：

```ts
interface AgentEvent {
  version: 1

  agent:
    | "claude"
    | "codex"
    | "grok"

  event:
    | "session_started"
    | "turn_started"
    | "activity"
    | "needs_input"
    | "needs_approval"
    | "turn_finished"
    | "session_ended"
    | "failure"

  sessionId?: string

  pid?: number

  workspaceId?: string

  surfaceId?: string

  activity?: string

  timestamp: number
}
```

---

# 11. Hook 原则

Hook 只负责：

```text
告诉系统 Agent 状态变化
```

Hook 不负责：

- 传输完整 Agent 输出。
- 保存源码。
- 保存 Prompt。
- 控制 Agent。
- 运行复杂逻辑。

完整内容永远通过 cmux Surface 获取。

因此：

```text
cmux
→ 内容

Hooks
→ 状态

cmux
→ 控制
```

---

# 12. 系统总体架构

```text
                ┌────────────────────┐
                │ Mobile Web / PWA   │
                │                    │
                │ Agent Inbox        │
                │ Workspace          │
                │ Agent Session      │
                └─────────┬──────────┘
                          │
                   HTTP / WebSocket
                          │
                          ▼
┌────────────────────────────────────────────┐
│          CMUX Agent Remote Server          │
│                                            │
│  ┌──────────────┐   ┌──────────────────┐  │
│  │ Web API      │   │ WebSocket        │  │
│  └──────────────┘   └──────────────────┘  │
│                                            │
│  ┌──────────────────────────────────────┐ │
│  │ State Engine                         │ │
│  │                                      │ │
│  │ Surface + Agent + Hook + Process     │ │
│  └──────────────────────────────────────┘ │
│          ▲                     ▲           │
│          │                     │           │
│  ┌───────┴────────┐     ┌──────┴───────┐  │
│  │ cmux Adapter   │     │ Hook Adapter │  │
│  └───────┬────────┘     └──────▲───────┘  │
└──────────┼─────────────────────┼───────────┘
           │                     │
           ▼                     │
       cmux Socket          Agent Hooks
                              │
                       ┌──────┼──────┐
                       ▼      ▼      ▼
                    Claude  Codex   Grok
```

---

# 13. 系统模块

## Module 1：cmux Adapter

职责：

> 系统的眼睛和手。

负责：

- 获取 Workspace。
- 获取 Pane。
- 获取 Surface。
- Agent Process Discovery。
- 读取 Surface 输出。
- 向 Surface 发送文本。
- 向 Surface 发送按键。

提供统一接口：

```ts
interface CmuxClient {

  getTree(): Promise<CmuxTree>

  readSurface(
    surfaceId: string
  ): Promise<SurfaceSnapshot>

  sendText(
    surfaceId: string,
    text: string
  ): Promise<void>

  sendKey(
    surfaceId: string,
    key: CmuxKey
  ): Promise<void>
}
```

第一版可以先使用 cmux CLI。

后续切换为 cmux Unix Socket。

上层业务不感知实现变化。

---

# 14. Module 2：Agent Hook Adapter

职责：

> 把三个 Agent 的事件翻译成统一语言。

包含：

```text
Claude Adapter
Codex Adapter
Grok Adapter
```

例如：

```text
Claude PermissionRequest
Codex PermissionRequest
Grok Approval Event
```

全部转换：

```text
NEEDS_APPROVAL
```

---

# 15. Module 3：State Engine

职责：

> 整个系统的大脑。

输入：

```text
cmux 状态
Agent Hook
进程状态
用户阅读状态
时间信息
```

输出：

```text
AgentState
```

例如：

```ts
interface AgentState {

  agent: "claude" | "codex" | "grok"

  sessionId?: string

  workspaceId: string

  paneId?: string

  surfaceId: string

  pid?: number

  status: AgentStatus

  currentActivity?: string

  lastActivityAt: number

  lastViewedAt?: number
}
```

---

# 16. Module 4：Web Server

推荐：

```text
Hono
+
Bun
```

职责：

- API。
- WebSocket。
- Hook Receiver。
- Web 静态文件。
- 登录。
- 控制权限。

本地地址：

```text
127.0.0.1:4318
```

局域网测试：

```text
0.0.0.0:4318
```

---

# 17. Module 5：Realtime Engine

负责实时同步。

使用：

```text
WebSocket
```

两类消息：

### 状态更新

```json
{
  "type": "agent.status_changed",
  "surfaceId": "surface:11",
  "status": "needs_approval"
}
```

### Surface 内容更新

```json
{
  "type": "surface.snapshot",
  "surfaceId": "surface:11",
  "revision": 128,
  "content": "Running tests..."
}
```

---

# 18. Surface 输出刷新策略

不应该不断读取所有终端。

推荐：

当前正在查看：

```text
300～500ms
```

Working Agent：

```text
1s
```

Idle：

```text
5～10s
```

完全不可见且无状态变化：

```text
无需持续读取
```

内容没变化时不向浏览器推送。

---

# 19. Module 6：Web Frontend

推荐：

```text
React
+
Vite
+
TypeScript
```

第一版不使用完整 xterm.js。

输出：

```text
普通文本 / pre
```

原因：

手机阅读体验更好。

后续增加：

```text
Terminal Mode
```

再考虑 xterm.js。

---

# 20. 技术栈

整体统一使用 TypeScript。

推荐：

```text
语言
TypeScript

Runtime
Bun

Backend
Hono

Frontend
React + Vite

Realtime
WebSocket

Validation
Zod

Storage
SQLite

Test
Vitest
```

---

# 21. 项目结构

```text
cmux-agent-remote/

├── apps/
│
│   ├── server/
│   │   └── src/
│   │
│   │       ├── cmux/
│   │       │   ├── client.ts
│   │       │   ├── discovery.ts
│   │       │   ├── output.ts
│   │       │   └── control.ts
│   │       │
│   │       ├── hooks/
│   │       │   ├── claude.ts
│   │       │   ├── codex.ts
│   │       │   └── grok.ts
│   │       │
│   │       ├── state/
│   │       │   ├── store.ts
│   │       │   ├── engine.ts
│   │       │   └── stale.ts
│   │       │
│   │       ├── realtime/
│   │       │   └── websocket.ts
│   │       │
│   │       ├── api/
│   │       │   ├── agents.ts
│   │       │   ├── workspaces.ts
│   │       │   └── surfaces.ts
│   │       │
│   │       └── security/
│   │
│   └── web/
│       └── src/
│           ├── pages/
│           ├── components/
│           ├── hooks/
│           └── stores/
│
├── packages/
│
│   ├── protocol/
│   └── shared/
│
└── scripts/
    ├── install-hooks.ts
    └── uninstall-hooks.ts
```

---

# 22. API

## 获取 Agent 首页

```http
GET /api/agents
```

---

## 获取 cmux Tree

```http
GET /api/tree
```

---

## 获取 Surface 输出

```http
GET /api/surfaces/:surfaceId/output
```

---

## 输入内容

```http
POST /api/surfaces/:surfaceId/input
```

Request：

```json
{
  "text": "继续修改，然后重新运行测试",
  "submit": true
}
```

---

## 发送特殊按键

```http
POST /api/surfaces/:surfaceId/key
```

Request：

```json
{
  "key": "escape"
}
```

第一版允许：

```text
Enter
Escape
Tab
ArrowUp
ArrowDown
Ctrl+C
```

---

# 23. 安全设计

虽然 V0 是本地工具，但必须从第一版处理安全。

原因：

> 这个系统本质上拥有远程控制终端的能力。

---

## 23.1 Access Token

启动时生成单用户 Token。

例如：

```text
CMUX Agent Remote

Local:
http://localhost:4318

Access Token:
xxxxxxxxxxxxxxxx
```

首次访问输入 Token。

之后换 Session Cookie。

---

## 23.2 Read / Control Mode

默认：

```text
READ ONLY
```

需要显式开启：

```text
CONTROL MODE
```

一段时间无操作以后自动返回只读。

---

## 23.3 所有输入必须指定 Surface

禁止：

```text
send to current terminal
```

必须：

```text
surface:11
```

防止误操作其他 Agent。

---

## 23.4 危险操作确认

例如：

```text
Ctrl+C
Kill Agent
Kill tmux
Close Workspace
```

必须二次确认。

---

## 23.5 不保存完整终端内容

SQLite 默认不保存：

- Agent 对话全文。
- Terminal 输出。
- API Key。
- Source Code。

只保存：

```text
Agent 状态
时间
Session 信息
未读状态
用户配置
操作审计
```

---

# 24. V0 开发范围

V0 目标：

> 在电脑浏览器里证明 cmux Web Remote 能成立。

完成：

- 获取 Workspace。
- 获取 Pane。
- 获取 Surface。
- 识别 Agent。
- 查看 Surface 输出。
- 输入文本。
- Enter。
- Esc。
- Ctrl+C。

V0 完成标准：

```text
Web 输入：
继续完成这个任务

→ Codex Surface 收到

Codex 输出变化

→ Web 能看到
```

---

# 25. V0.1 开发范围

加入 Agent Hooks。

支持：

```text
Claude
Codex
Grok
```

实现：

```text
WORKING
NEEDS_APPROVAL
NEEDS_INPUT
RESPONDED_UNREAD
IDLE
ERROR
```

增加：

```text
Attention Inbox
```

---

# 26. V0.2 手机适配

完成：

- Responsive UI。
- 手机输入。
- 中文输入。
- WebSocket 自动重连。
- Surface 切换。
- 触控交互。
- PWA 基础能力。

同一 Wi-Fi 下：

```text
iPhone
→ Mac LAN IP
→ CMUX Agent Remote
```

---

# 27. V0.3 公网访问

在本地系统完全稳定以后，再增加公网访问。

网络层与核心系统解耦：

```text
Mobile
↓
公网 Tunnel
↓
localhost:4318
↓
CMUX Agent Remote
```

可以选择：

```text
Tailscale
Cloudflare Tunnel
ngrok
Sealos Relay
其他 Tunnel
```

第一版核心代码不绑定某个平台。

---

# 28. V1：tmux 长任务

V1 开始支持 Agent 创建的长期后台任务。

结构：

```text
Project
├── CMUX
│   └── Workspace
│       └── Surface / Agent
│
└── TMUX
    ├── dev server
    ├── worker
    └── long task
```

支持：

- tmux Session Discovery。
- 当前命令。
- PID。
- 输出。
- 退出码。
- Restart。
- Stop。
- 健康检查。
- 端口。

---

# 29. V1：Project 聚合

Project 一般根据：

```text
Git Repository Root
```

判断。

例如：

```text
show-case-demo-web

CMUX
├── Codex
└── Claude

TMUX
├── dev :3000
├── api :8000
└── worker
```

这样 cmux Workspace 消失以后，tmux 仍然属于这个 Project。

---

# 30. V2：云端 Relay

只有需要：

```text
任意设备
打开网页
登录
选择自己的 Mac
控制 Agent
```

时才需要云端 Relay。

架构：

```text
Mobile
↓
Cloud Relay
↕
Mac Bridge
↓
cmux
```

Mac 主动向云端建立出站连接。

这部分不属于第一版。

---

# 31. 产品核心原则

整个产品保持以下边界：

### cmux

负责：

```text
Terminal 结构
Terminal 内容
Terminal 控制
```

### Agent Hooks

负责：

```text
Agent 语义状态
```

### State Engine

负责：

```text
融合状态
注意力排序
未读
异常判断
```

### Web

负责：

```text
远程查看
远程输入
移动端交互
```

---

# 32. 第一版最终用户体验

用户在 Mac 上启动：

```bash
cmux-agent-remote
```

浏览器打开：

```text
localhost:4318
```

首页看到：

```text
2 Need You
3 Working
4 Idle
```

用户点击：

```text
世界模型 Demo
Codex · Responded
```

看到：

```text
Tests are now passing.

I updated 3 files and fixed the
evaluation mapping.
```

然后直接输入：

```text
很好，继续检查一下边界 case，然后提交 commit。
```

点击 Send。

消息被发送到：

```text
workspace:5
surface:11
Codex
```

Codex 开始执行。

手机页面状态：

```text
Responded
→ Working
```

等 Codex 再次回复：

```text
Working
→ Responded · unread
```

首页立即出现：

```text
◇ Codex finished
```

这就是第一版最核心、最完整的闭环。

---

# 33. MVP 验收标准

MVP 可以认为完成，需要满足：

- [ ] 能自动获取所有 cmux Workspace。
- [ ] 能获取 Workspace 下所有 Surface。
- [ ] 能识别 Claude / Codex / Grok。
- [ ] 能准确把 Agent 与 Surface 绑定。
- [ ] 能读取指定 Surface 输出。
- [ ] 能向指定 Surface 输入 Prompt。
- [ ] 能发送 Enter / Esc / Ctrl+C。
- [ ] 三个 Agent 均可以通过 Hook 上报状态。
- [ ] 能显示 Working / Needs You / Responded / Idle。
- [ ] Responded 支持未读状态。
- [ ] 首页按 Attention Priority 排序。
- [ ] 手机浏览器可以正常使用。
- [ ] WebSocket 断线后可以恢复。
- [ ] 所有写操作必须明确指定 Surface。
- [ ] 系统具有基础访问 Token。
- [ ] Hook 服务失效不会影响 Agent 本身运行。

---

# 34. 一句话定义

> **CMUX Agent Remote 是一个运行在 Mac 上、通过 Web 和手机远程查看与控制 Claude Code、Codex 和 Grok Build 的多 Agent Control Center。**

它的核心不是远程 Terminal，而是：

> **随时知道哪个 Agent 在做什么、哪个 Agent 在等你，并能够立即接手。**