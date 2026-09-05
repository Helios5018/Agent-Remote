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
├── services/    surface 翻页流程
├── state/       store(SQLite) / engine(大脑) / stale(时间规则)
├── realtime/    hub(运行时无关) / poller(分级刷新) / websocket(Bun 绑定)
├── api/         agents / workspaces / surfaces / hooks / auth
└── security/    token / session / 中间件

apps/web/src/    React + Vite，移动优先，无第三方路由与状态库
packages/protocol/  Zod schema + 类型（前后端共享）
packages/shared/    时间、终端文本清洗、缓存等纯函数
scripts/         cmux-agent-web-hook（真正跑在 Agent 里的 shell）+ 安装/卸载
```

`CmuxClient` 是接口，第一版用 cmux CLI 实现，后续可切到 Unix Socket，上层业务无感。

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

## 刷新策略

| 场景 | 间隔 |
|------|------|
| 用户正在查看的 surface | 400ms |
| Working / 等待用户的 Agent | 1s |
| Idle（无 Hook） | 8s |
| Idle（有 Hook 托底）且无人查看 | 不轮询 |

内容指纹没变化就不推送给浏览器；`tree` / `top` 带 1s TTL 缓存与 single-flight 合并。

## 前端职责

- `pages/` 组装页面；`features/workspace/` 负责结构树节点；`features/session/` 保存会话规则。
- `stores/AppStore.tsx` 组装认证、数据加载与稳定操作方法；`selectors.ts` 保存查询和派生逻辑。
- `stores/surface-cache.ts` 按 surface 通知画面变化，网格更新不再更新全局 Context。
- `realtime/connection.ts` 管理 WebSocket、心跳、退避和销毁；`hooks/useRealtime.ts` 绑定 React 生命周期。
- `styles.css` 仅按顺序导入主题样式；`styles/` 保存基础、结构树、会话、网格、输入区和公共样式。

## 实时恢复

WebSocket 每 15 秒发送应用心跳，45 秒无 pong 后重连；销毁后旧回调不会再次连接。重连时恢复订阅，并主动同步列表、拓扑与当前画面。断线时三者每 5 秒降级刷新，同一轮完成后再安排下一轮。

无 Hook 会话即使画面未变化，也会检查静止时间；正在查看的普通 shell 同样使用 400ms 刷新。网格和纯文本独立编号，切换来源重新建立基线；StateEngine 的 outputRevision 为轮询器维护的活动版本，HTTP 读屏不修改该值。

注意力排序、分组与统计由 protocol 的 buildInbox 统一生成，前端收到单个 Agent 更新后也会重算。
