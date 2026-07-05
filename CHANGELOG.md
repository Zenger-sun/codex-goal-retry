# Changelog

## 0.1.0

- Add a VS Code companion extension that inspects the installed OpenAI Codex extension.
- Add a goal/heartbeat-only long retry patch for Codex webview bundle signature `26.623.101652`.
- Preserve Codex built-in 750ms short retry behavior.
- Preserve the failed-thread marker path and add one deduplicated long retry timer per thread.
- Add restore support for bundles patched by this tool.
- Add local syntax checks, installed-extension inspection, and patcher self-test scripts.
