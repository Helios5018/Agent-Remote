# Agent HTTP 接入与现场上下文验收记录

日期：2026-09-10。实施依据：[实施计划](Agent-HTTP接入与现场上下文.md)。

## 交付状态

| 项目 | 结果 |
| --- | --- |
| 源码与协议 | 完成：info、context、Shell workspace、公开 Markdown 路由 |
| 文档 | 完成：唯一指南正文 docs/agent-guide.md，README 入口及 API 合同同步 |
| 自动化 | 30 个测试文件、340 个测试全部通过；新增专项 17 个 |
| 类型与构建 | bun run typecheck、bun run build、git diff --check 通过 |
| 真实 Bun / cmux | 独立 HTTP 客户端完成 25 项运行验收，详见下文 |
| 公网发布 | 未执行；运行中的正式 4318 进程未重启，未刷新 Sealtun 隧道，公网新接口未验证 |
| 提交与推送 | 未执行 |

## 实现要点

- StateStore 用 settings.instance_id 插入不存在才初始化并回读 UUID。info 登录后可读、no-store，不返回凭证或本机路径。
- context 用 UUID 从缓存拓扑定位，读取 StateEngine 而不标记已读或同步状态；已发现类型与旧状态类型不符时不混用旧会话状态。cwd 仅探测目标 surface，Git 只取本地摘要，不 fetch。
- readSurfaceText 独立于 SnapshotTracker；原 readSurface 保留跟踪行为。context 输出清理终端控制内容、限制最近 200 行和 64 KiB，保留完整 UTF-8；核心失败 503，分段失败 200 加 null/issues。
- workspace launch 缺省/null 只安全引用目录并 cd；Agent 值保持兼容。初始化部分失败返回已创建 UUID，区分正文写入未知与 Enter 未确认，不诱导重复创建。
- 指南按模块路径读取唯一源文件；生产 index.ts 在静态回退前明确路由，缺失/空源返回 503。真实 demo 使用 UUID 拓扑，避免 demo context 无法寻址。
- 指南覆盖 Cookie、实例核验、所有 HTTP 接口、上传 headers、同 Session 两阶段删除、项目规则读取、输入和创建结果未知时的恢复、地址及凭证更换、WebSocket 与 TUI 复位。

## 自动化证据

最终执行 `bun run test`：30 files passed，340 tests passed。

专项 `apps/server/test/agent-context.test.ts` 17 项覆盖：数据库重新打开/不同数据库、info 鉴权与字段、Agent 与普通 Shell、未初始化状态、旧 Agent 状态不匹配、非 Git/unborn/dirty/detached Git、cwd/Git/output 故障、无效/不存在目标、核心拓扑故障、UTF-8 与行字节上限、CLI 跟踪器隔离、读前后状态与写调用不变、Shell launch null/缺省/Agent、带空格和单引号目录、初始化部分失败、目录校验、指南缺失/空源、Cookie 删除归属。

相关既有输入、创建、文件、Git、实时状态与前端回归均通过。类型检查通过；Vite 构建通过（104 modules）；git diff --check 通过。

## 真实运行验收

可复现命令（需要本机 Bun、tmux 和正在运行的 cmux）：

```bash
python3 /Users/link/AgentWork/PersonalProjcects/Agent-Remote/scripts/verify-agent-http.py
```

脚本把本次服务源码与指南复制到 scratchpad 下的临时部署目录，独立设置 CAR_DATA_DIR、CAR_DB、CAR_PIN，并显式传 --db；启动后核验独立数据库和 Hook 配置确实存在。服务工作目录设为 `/`，排除依赖仓库 cwd 的假通过。测试只向其新建 workspace 输入无害命令。

运行使用的 tmux session 为 `agent-remote-http-test`（4328）和 `agent-remote-http-demo`（4329）。启动形态：`CAR_DATA_DIR=<临时数据目录> CAR_DB=<临时库> CAR_PIN=<测试PIN> bun <临时部署>/apps/server/src/index.ts --port <端口> --db <临时库>`，demo 追加 --demo。每次启动打印实际路径与命令；日志在临时目录 `<session>.log`，查看可用 `cat <日志路径>`，停止可用 `tmux kill-session -t <session>`。验收结束这两个 session 和临时目录均已清理，因此当前无测试日志长驻。

25 项检查全部通过，范围包括：

1. 匿名 info 被拒绝；独立登录后可读真实 cmux tree。
2. 无 dist、cwd=/ 时指南为原始 Markdown；有 SPA dist 时指南仍绕过 HTML；源文件缺失真实入口返回 503。
3. 创建纯 Shell workspace，在带空格和单引号的真实目录正确初始化；Agent 为 null，Git 摘要符合临时仓库。
4. 在新 Shell 执行 pwd/printf。输出标记通过分开的参数拼接，输入回显本身无法满足成功条件。
5. 通过文件 API 读取临时 README/AGENTS；Git status 正确；中文/emoji 文件原始上传、preview 和 download 哈希一致；同 Cookie 完成 prepare/delete。
6. 127.0.0.1 → localhost，新 Cookie jar 重登后 instanceId、项目目录和 surface UUID 保持对应。
7. 同独立数据库重启保留实例 ID 和有效旧 Cookie；测试库 PIN 改变后旧 Cookie 失效，新凭证重登仍为相同实例。
8. 另一 demo 数据库 ID 不同，旧目标不被沿用；demo UUID 可读取 context。
9. 客户端丢弃输入/创建响应后，通过输出/tree 观察结果，没有再次发送正文或重复创建。这里模拟客户端不消费响应，不是网络层丢包注入；本版仍没有服务端幂等保证。

最终收尾确认：4328/4329 测试 session 已停止，本次 cmux workspace 已关闭，scratchpad/agent-http-* 已清理；正式 agent-remote-web 与 4318 原进程仍运行。

## 首次测试隔离事故与恢复

首次脚本错误使用当前服务不支持的 `--data-dir` 参数（未知参数被忽略），导致首轮 4328 测试使用了默认 `~/.cmux-agent-remote/state.db`。测试 PIN 写入默认数据库并清除了原有持久化 web_sessions，Hook 配置也一度被改为 4328。这是执行失误，不能归为通过的隔离测试。

已采取并核验：

- 从正式运行进程的启动信息取得原 PIN，恢复数据库 access_pin；核对恢复值与运行进程一致，未在文档或输出中披露凭证。
- 恢复 Hook endpoint 为 http://127.0.0.1:4318/api/hooks，保留原 Hook 密钥。
- 关闭首次测试创建的 workspace，清除该会话关联的上传残留、两个测试 Session 和临时部署；在审计元数据记录恢复情况。
- 修改脚本为 CAR_DATA_DIR + CAR_DB + 显式 --db，启动后验证隔离库和 Hook 路径。后续完整 25 项验收均在独立数据库执行。
- 正式进程未重启，health 正常。当前进程中的既有 Session 保持有效；已被清除的旧 Session 持久化记录无法恢复，因此之后重启正式服务可能需要重新登录。此限制已向用户说明。

没有把本次事故描述为“正式数据完全未变化”。正式 PIN 与 Hook 已恢复，但无法恢复的登录持久化影响如上。

## 发布边界与剩余限制

本次完成源码、文档、自动化和本机真实运行验收。实施计划将正式发布设为后续独立授权，因此未执行 refresh，也没有用测试服务替换正式入口。后续发布应按 launch-public 原地刷新，核验本地/公网 guide、health、登录后的 info/context、相同 instanceId 与构建资源哈希。

context 是有限现场观察，不是完整 Agent 对话；状态、cwd、Git 和输出不是跨接口事务快照。任务完成需按实际产物验证；写入或创建响应未知时必须先观察，本版没有幂等存储或结构化退出码 Job。
