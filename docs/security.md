## 安全

这个系统本质上拥有远程控制终端的能力，所以第一版就做了：

- **Access PIN + 登录限流**：首次访问输入 4 位 PIN，之后换 HttpOnly Session Cookie。
  4 位本身很弱，靠指数级锁定兜底：前 5 次失败免费，之后锁 60s 并逐次翻倍（上限 1 小时），
  失败计数要 6 小时无新失败才清零，另有跨来源全局闸门防 IP 轮换 —— 每天最多约 24 次尝试。
  触发锁定时服务端终端打印告警，`--unlock` 可手动解锁。
- **两把钥匙分开**：人用的是短 PIN，Hook 用的是长随机密钥，且 Hook 接口**只接受本机回环**
  请求（带 `X-Forwarded-For` 的一律拒绝）—— PIN 短不会连累 Hook 接口。
- **登录即控制**：PIN 过了就能读写；不再分只读 / 控制模式，也没有超时回落。
- **所有写操作必须指定 surface**：不存在 "send to current terminal"，服务端强制校验。
- **危险操作二次确认**：`Ctrl+C` 未带 `confirm` 返回 `428`。
- **防注入**：所有 cmux 调用走参数数组 + `--`，不经过 shell。
- **不保存终端内容**：SQLite 只存状态 / 时间 / Session / 未读 / 配置 / 审计；
  审计只记录 `len=… submit=…`，不落 prompt 原文。
- **Hook 失效不影响 Agent**：Hook 接口永远返回 200，hook 脚本任何情况下 exit 0 且 stdout 为空。
- **代理头默认不信任**：只有显式 `--trust-proxy` 才读 `X-Forwarded-For` / `X-Forwarded-Proto`，
  否则伪造这两个头就能绕开限流。

默认只监听 `127.0.0.1`，`--lan` 才对局域网开放。
公网暴露（Tailscale / Cloudflare Tunnel / ngrok）请按 [docs/公网暴露指南.md](公网暴露指南.md) 来。
