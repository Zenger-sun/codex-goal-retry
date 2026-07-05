# Codex Goal Retry

A companion VS Code extension project that manages a goal-only long retry patch for the OpenAI Codex VS Code extension.

这个项目用于解决 Codex VS Code 扩展的 goal/heartbeat automation 在执行过程中，因临时网络问题、服务短暂不可达或远程连接波动导致 goal 中断的问题。只要 goal 目标尚未达成，补丁会在 Codex 当前短重试机制之后，再按 5/10/30 分钟配置追加长期重试，尝试恢复原本的 heartbeat/goal resume 流程。它不会修改通用 HTTP/stream 请求重试层。

## 状态

- 目标 Codex 扩展：`openai.chatgpt`
- 已按本机安装版本验证签名：`26.623.101652`
- 默认长期重试间隔：5 分钟
- 可配置间隔：5、10、30 分钟
- 安装后不会自动修改 Codex，需要手动运行命令
- 当前没有包含 OpenAI Codex 扩展源码，也不是重新分发官方扩展；这是一个可 fork、可发布的 companion patch manager

我在 GitHub 和 VS Code Marketplace 以 Codex goal retry、heartbeat automation retry、OpenAI Codex VS Code retry 等关键词没有找到现成同类插件，所以这里保留为自建扩展源码。

## 原理

Codex webview bundle 中已有 heartbeat automation resume 流程。当前失败处理会：

1. 记录 `heartbeat_automation_resume_failed` warning。
2. 对 `no rollout found for thread id` 这类错误加入失败集合并停止尝试。
3. 对普通失败保留一个内置的 750ms 短重试。

本扩展的 `Apply Goal Retry Patch` 命令会定位 Codex 扩展内包含 `heartbeat_automation_resume_failed` 和 `maybe-resume-conversation` 的 webview 资产，只替换该 catch 分支：

- 保留原始 warning 日志。
- 保留原始 `f.current.add(t)` 失败集合路径。
- 保留原始 750ms 短重试。
- 新增每个 thread 去重的长期计时器。
- 长期计时器到点后清除该 thread 的失败标记，并触发 Codex 原本的 resume 检查；如果 goal 已完成或已恢复，原本逻辑会自然跳过。
- 不写入 `out/extension.js` 中的 HTTP/stream 请求层。

## 使用

### 从 GitHub 获取

```bash
git clone https://github.com/Zenger-sun/codex-goal-retry.git
cd codex-goal-retry
npm run test
```

Windows PowerShell 如果提示 `npm.ps1` 被执行策略拦截，可以改用：

```bash
npm.cmd run test
```

### 检查本机 Codex 安装

```bash
npm run check:syntax
npm run check:installed
```

`check:installed` 会自动查找本机 `openai.chatgpt-*` 扩展，并报告目标 webview bundle 是否是 `supported-original` 或 `patched`。只有状态是 `supported-original` 或 `patched` 时才建议继续应用补丁；如果是 `unsupported-signature`，说明 OpenAI 更新后 bundle 签名变化，需要先重新分析目标代码。

如果 Codex 扩展安装在非默认位置，可以传入路径：

```bash
node scripts/check.js "C:\Users\<you>\.vscode\extensions\openai.chatgpt-26.623.101652-win32-x64"
```

也可以设置环境变量 `CODEX_EXTENSION_PATH` 后运行 `npm run check:installed`。

### 调试运行

在 VS Code 打开本仓库，按 `F5` 启动 Extension Development Host，然后打开命令面板：

- `Codex Goal Retry: Inspect Installed Codex`
- `Codex Goal Retry: Apply Goal Retry Patch`
- `Codex Goal Retry: Restore Original Codex Bundle`

应用或恢复后需要 Reload VS Code。

### 打包 VSIX

发布 `.vsix` 时可使用：

```bash
npx @vscode/vsce package
```

生成后可以本地安装：

```bash
code --install-extension codex-goal-retry-0.1.0.vsix
```

如果后续要发布到 VS Code Marketplace，需要先把 `package.json` 中的 `publisher` 改成自己的 Marketplace publisher id，并确认 `repository`、`bugs`、`homepage` 指向实际 GitHub 仓库。

### 上传 GitHub

首次上传可以执行：

```bash
git init
git add .
git commit -m "Initial release"
git branch -M main
git remote add origin https://github.com/Zenger-sun/codex-goal-retry.git
git push -u origin main
```

如果你的 GitHub 用户名或仓库名不同，请同步修改上面的远程地址以及 `package.json` 中的 GitHub URL。

## 配置

```json
{
  "codexGoalRetry.intervalMinutes": 5,
  "codexGoalRetry.codexExtensionId": "openai.chatgpt",
  "codexGoalRetry.codexExtensionPath": ""
}
```

`codexGoalRetry.intervalMinutes` 支持 `5`、`10`、`30`。如果你 fork 了 Codex 扩展或扩展 id 变化，可以设置 `codexGoalRetry.codexExtensionPath` 指向目标扩展目录。

## 安全边界

- 不会自动安装到本机。
- 不会在激活时自动修改 Codex。
- 应用补丁前会创建备份到 Codex 扩展目录下的 `.codex-goal-retry-backups/`。
- 如果 OpenAI 更新后 bundle 签名不匹配，命令会拒绝修改。
- `Restore Original Codex Bundle` 可撤销本工具插入的补丁块。
- 通用 HTTP/stream 请求重试层只做检测报告，不会写入。

## 适合的场景

适合 goal 模式运行期间，远程网络偶发断开、服务短暂不可达、夜间长时间执行等导致 goal resume/heartbeat 中断，但目标尚未达成的情况。它不是通用请求重试器，也不改变普通聊天、review、HTTP stream 的 retry 策略。
