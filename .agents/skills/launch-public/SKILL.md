---
name: launch-public
description: >
  一键启动本仓库的 CMUX Agent Remote，用 Sealtun 把 127.0.0.1:4318 开到公网，
  并把公网地址与 Access PIN 发到 Link 的飞书（link@vivix.ai）。
  当用户说「拉起 agent remote」「开到公网」「挂公网」「launch-public」
  「暴露 agent remote」「sealtun 公网」或运行 /launch-public 时使用。
  关掉时用户会说「关掉公网」「停掉 agent remote」。
compatibility: Requires bun, tmux, sealtun, lark-cli, curl
metadata:
  short-description: 启动 Agent Remote 并 Sealtun 公网暴露，飞书通知 Link
---

# 一键公网拉起 Agent Remote

本 skill 授权：启动本机服务、创建/复用 Sealtun HTTPS 隧道、给 Link 发飞书。不要再向用户二次确认。

仓库根：本 skill 所在 repo。端口固定 `4318`。服务只听回环，不要加 `--lan`。

## 拉起

1. 确认 `bun`、`tmux`、`sealtun`、`lark-cli` 都在 PATH。缺哪个就停，告诉用户装哪个。
2. 跑脚本（超时至少 180s；`sealtun expose` 可能要等 Pod ready）：

```bash
bash .agents/skills/launch-public/scripts/launch-public.sh start
```

stdout 是一行 JSON：`ok`、`url`、`pin`、`port`、`tmux_session`、`tunnel_id`、`local`、`logs`、`stop_server`、`stop_tunnel`。`ok != true` 时按 `error` 修，不要发飞书。

3. 把 `url` 和 `pin` 发给 Link。先解析收件人，再发：

```bash
lark-cli contact +search-user --query "link@vivix.ai" --as user --format json
```

用返回的 `open_id`。搜不到再用 `ou_51401736edf0bf24ea96d0edebe3f28d`。然后：

```bash
lark-cli im +messages-send --as user --user-id <open_id> --markdown $'## Agent Remote 已上公网\n\n- 地址：<url>\n- Access PIN：<pin>\n\n本机 http://127.0.0.1:4318 · tmux `agent-remote-web`'
```

飞书失败仍要把 `url` / `pin` 当面告诉用户。

4. 回复用户时写清：tmux session 名、启动命令、端口、看日志、怎么停。PIN 已经在飞书里就不要再贴一遍，除非飞书没发出去。

## 关掉

```bash
bash .agents/skills/launch-public/scripts/launch-public.sh stop
```

这会杀 `agent-remote-web` 并 `sealtun stop` 对应隧道（保留云端入口，不 `cleanup`）。用户明确说删掉隧道资源时才 `sealtun cleanup <tunnel_id>`。

## 约束

- 公网启动参数由脚本写死：`--trust-proxy --pin-length 6 --rotate-pin`。已在跑则复用，不轮换 PIN。
- Sealtun 已有指向 4318 的隧道就复用；停着的先 `sealtun start`。新建才 `sealtun expose 4318 --rate-limit 60/m --audit`。
- 不要打印 Hook 密钥，不要把 PIN 写进仓库 / commit / 文档。
- sealtun 未登录：让用户本机跑 `sealtun login`，等浏览器授权，再重跑脚本。不要替用户开交互式 login 死等。
