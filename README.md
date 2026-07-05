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

### 本地操作手册

#### 1. 安装当前项目到 VS Code

先在项目目录中确认语法和补丁逻辑正常：

```bash
npm.cmd run test
npm.cmd run check:installed
```

如果 `check:installed` 输出的 `Goal retry patch status` 是 `supported-original` 或 `patched`，可以继续打包安装：

```bash
vsce.cmd package
code.cmd --install-extension codex-goal-retry-0.1.0.vsix --force
```

如果本机没有全局安装 `vsce`，也可以使用：

```bash
npx @vscode/vsce package
code --install-extension codex-goal-retry-0.1.0.vsix --force
```

安装完成后，VS Code 扩展列表中应能看到 `Codex Goal Retry`。

#### 2. 应用长期重试补丁

安装本扩展后不会自动修改 Codex，需要手动应用补丁：

1. 在 VS Code 按 `Ctrl+Shift+P` 打开命令面板。
2. 运行 `Codex Goal Retry: Inspect Installed Codex`，确认当前状态。
3. 运行 `Codex Goal Retry: Apply Goal Retry Patch`。
4. 确认弹窗中的 `Apply Patch`。
5. Reload VS Code。

应用后，Codex 原有 750ms 短重试仍会保留；本工具只额外增加 goal/heartbeat 场景的长期重试。

#### 3. 修改重试时间

打开 VS Code 设置，搜索 `Codex Goal Retry`，修改 `Interval Minutes`。

也可以直接在 VS Code `settings.json` 中写入：

```json
{
  "codexGoalRetry.intervalMinutes": 10
}
```

目前只支持 `5`、`10`、`30` 分钟。修改设置后，需要再次运行：

```text
Codex Goal Retry: Apply Goal Retry Patch
```

然后 Reload VS Code。重试时间会写入 Codex webview bundle，只改设置但不重新应用补丁不会改变已写入的等待时间。

#### 4. 查看当前补丁状态

在命令面板运行：

```text
Codex Goal Retry: Inspect Installed Codex
```

也可以在项目目录运行：

```bash
npm.cmd run check:installed
```

常见状态含义：

- `supported-original`：当前 Codex bundle 是支持的原始版本，可以应用补丁。
- `patched`：已经应用过本工具补丁。
- `unsupported-signature`：Codex 更新后目标代码签名变化，暂时不要应用补丁，需要先重新分析适配。
- `not-found`：没有找到目标 heartbeat/goal webview 资产。

#### 5. 确认重试机制已经生效

确认分为两步：

1. 确认真实安装的 Codex bundle 已经写入补丁。
2. 用本项目的本地仿真场景确认“失败后长期重试”逻辑会触发。

先检查真实安装状态：

```bash
npm.cmd run check:installed
```

如果输出包含类似信息，说明补丁已经写入真实 Codex bundle：

```text
Goal retry patch status: patched
Long retry delay: 300000 ms
Preserves built-in 750ms retry: yes
Preserves failed-thread marker path: yes
```

`Long retry delay` 对应关系：

- `300000 ms`：5 分钟
- `600000 ms`：10 分钟
- `1800000 ms`：30 分钟

然后运行本地失败重试仿真：

```bash
npm.cmd run test:retry-scenario
```

该测试会在系统临时目录构造一个假的 Codex 扩展目录，写入和真实补丁相同的 catch 分支，再用 fake timer 模拟 goal/heartbeat 失败后的重试路径。它不会修改本机真实安装的 OpenAI Codex 扩展。

通过时会看到：

```text
retry scenario passed
patched status: patched
long retry delay: 300000 ms (5 minutes)
terminal goal failure: schedules one deduplicated long retry, clears failed-thread marker, triggers resume
normal failure: preserves built-in 750 ms retry and also schedules long retry
resolved goal: long timer does not trigger resume when goal is already resolved
```

这表示：

- goal/heartbeat 失败后会记录 `heartbeat_automation_resume_failed`。
- 对同一个 thread 只会安排一个长期重试计时器，避免重复堆积。
- 长期计时器触发时会清理 failed-thread 标记，并触发 Codex 原本的 resume 检查。
- 普通失败仍保留 Codex 原本的 750ms 短重试。
- 如果 goal 已经结束，长期计时器不会再触发 resume。

也可以指定仿真中的长期重试间隔：

```bash
node scripts/retry-scenario.js 10
node scripts/retry-scenario.js 30
```

#### 6. 关闭长期重试并恢复原始 Codex

如果想关闭本工具增加的长期重试，必须先恢复原始 Codex bundle：

1. 在 VS Code 按 `Ctrl+Shift+P` 打开命令面板。
2. 运行 `Codex Goal Retry: Restore Original Codex Bundle`。
3. 确认弹窗中的 `Restore`。
4. Reload VS Code。

恢复后，长期重试会关闭，Codex 回到原始 heartbeat/goal retry 行为。

注意：单纯禁用或卸载 `Codex Goal Retry` 扩展，不一定会撤销已经写入 Codex bundle 的补丁。正确关闭顺序是先运行 `Restore Original Codex Bundle`，再按需禁用或卸载本扩展。

#### 7. 卸载本扩展

确认已经运行 `Restore Original Codex Bundle` 并 Reload VS Code 后，可以在扩展面板中卸载 `Codex Goal Retry`，也可以使用命令行：

```bash
code.cmd --uninstall-extension vanex.codex-goal-retry
```

如果之后重新安装或 Codex 自动更新，建议先运行 `Inspect Installed Codex` 或 `npm.cmd run check:installed`，确认状态后再应用补丁。

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
