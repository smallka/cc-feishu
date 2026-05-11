# TODO

## Codex integration follow-ups

- Add single-instance locking at startup to prevent stale WebSocket-connected processes from serving traffic.
- Expose runtime instance metadata in `/debug` or `/stat`, including PID, instance ID, provider, and process start time.
- Finalize and keep the expanded AI input/output logging for Feishu entry, ChatManager, ClaudeAgent, and CodexAgent.
- Commit the Step 3 provider-selection changes after final verification.
- Add project-level Codex configuration for model/provider/base URL instead of relying only on `~/.codex/config.toml`.
- Add a real end-to-end validation pass for `AGENT_PROVIDER=codex` over the Feishu WebSocket flow.
