## Hook

Claude、Codex、Grok 三家的用户级 hook 最终都调用同一个脚本。Pi 当前已支持进程识别、
终端查看控制和输出变化状态推断，精确生命周期 Hook 将通过 Pi Extension 接入。

```bash
scripts/cmux-agent-web-hook <claude|codex|grok> <NativeEventName>
```

| Agent | 配置文件 | 挂载事件 |
|-------|----------|----------|
| Claude Code | `~/.claude/settings.json` | SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Notification / Stop / SessionEnd |
| Codex CLI | `~/.codex/hooks.json` | SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / PermissionRequest / Stop |
| Grok Build | `~/.grok/hooks/cmux-agent-remote.json` | SessionStart / UserPromptSubmit / PreToolUse / Notification / Stop / SessionEnd |

安装器会先备份成带时间戳的 `.bak`，只合并自己的条目，卸载时也只删自己的（cmux 自带的 hook 不受影响）。
脚本从 `~/.cmux-agent-remote/hook.json` 读取端口与 token（服务启动时自动写入）。

Hook 与 surface 的关联顺序：`CMUX_SURFACE_ID` → pid 反查 cmux 进程树 → sessionId → workspace + agent 类型唯一命中。
