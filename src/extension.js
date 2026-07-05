'use strict';

const vscode = require('vscode');
const {
  DEFAULT_INTERVAL_MINUTES,
  inspectInstallation,
  applyPatch,
  restorePatch,
  formatReport
} = require('./patcher');

function getConfig() {
  const config = vscode.workspace.getConfiguration('codexGoalRetry');
  return {
    intervalMinutes: config.get('intervalMinutes', DEFAULT_INTERVAL_MINUTES),
    codexExtensionId: config.get('codexExtensionId', 'openai.chatgpt'),
    codexExtensionPath: config.get('codexExtensionPath', '').trim()
  };
}

function resolveCodexExtensionPath() {
  const config = getConfig();
  if (config.codexExtensionPath.length > 0) {
    return config.codexExtensionPath;
  }

  const codexExtension = vscode.extensions.getExtension(config.codexExtensionId);
  if (!codexExtension) {
    throw new Error(`Could not find VS Code extension ${config.codexExtensionId}. Set codexGoalRetry.codexExtensionPath if you use a forked Codex extension.`);
  }

  return codexExtension.extensionPath;
}

function writeReport(output, title, report) {
  output.appendLine(`\n[${new Date().toISOString()}] ${title}`);
  output.appendLine(formatReport(report));
}

async function inspectCommand(output) {
  const extensionPath = resolveCodexExtensionPath();
  const report = inspectInstallation(extensionPath);
  writeReport(output, 'Inspect installed Codex', report);
  output.show(true);
  vscode.window.showInformationMessage(`Codex Goal Retry status: ${report.status}`);
}

async function applyPatchCommand(output) {
  const config = getConfig();
  const extensionPath = resolveCodexExtensionPath();
  const before = inspectInstallation(extensionPath);
  writeReport(output, 'Before applying patch', before);

  const choice = await vscode.window.showWarningMessage(
    `Apply Codex goal-only long retry patch to ${before.package?.version || 'the installed Codex extension'}? The built-in short retry stays in place; HTTP/stream retry code is not changed.`,
    { modal: true },
    'Apply Patch'
  );
  if (choice !== 'Apply Patch') {
    output.appendLine('Patch cancelled by user.');
    return;
  }

  const result = applyPatch(extensionPath, { intervalMinutes: config.intervalMinutes });
  output.appendLine(result.changed ? 'Patch written.' : 'Patch already up to date.');
  if (result.backupFile) {
    output.appendLine(`Backup created: ${result.backupFile}`);
  }
  writeReport(output, 'After applying patch', result.after);
  output.show(true);
  vscode.window.showInformationMessage(`Codex goal retry patch applied with ${config.intervalMinutes} minute long retry. Reload VS Code before relying on overnight goal mode.`);
}

async function restorePatchCommand(output) {
  const extensionPath = resolveCodexExtensionPath();
  const before = inspectInstallation(extensionPath);
  writeReport(output, 'Before restore', before);

  const choice = await vscode.window.showWarningMessage(
    'Restore the original Codex heartbeat/goal retry behavior for the installed Codex extension?',
    { modal: true },
    'Restore'
  );
  if (choice !== 'Restore') {
    output.appendLine('Restore cancelled by user.');
    return;
  }

  const result = restorePatch(extensionPath);
  output.appendLine(result.changed ? 'Original bundle restored.' : 'Bundle was already original.');
  if (result.backupFile) {
    output.appendLine(`Backup created: ${result.backupFile}`);
  }
  writeReport(output, 'After restore', result.after);
  output.show(true);
  vscode.window.showInformationMessage('Codex goal retry patch restored. Reload VS Code to use the restored bundle.');
}

function handleError(output, error) {
  const message = error instanceof Error ? error.message : String(error);
  output.appendLine(`Error: ${message}`);
  output.show(true);
  vscode.window.showErrorMessage(`Codex Goal Retry: ${message}`);
}

function activate(context) {
  const output = vscode.window.createOutputChannel('Codex Goal Retry');
  context.subscriptions.push(output);

  context.subscriptions.push(vscode.commands.registerCommand('codexGoalRetry.inspect', () => inspectCommand(output).catch((error) => handleError(output, error))));
  context.subscriptions.push(vscode.commands.registerCommand('codexGoalRetry.applyPatch', () => applyPatchCommand(output).catch((error) => handleError(output, error))));
  context.subscriptions.push(vscode.commands.registerCommand('codexGoalRetry.restorePatch', () => restorePatchCommand(output).catch((error) => handleError(output, error))));
}

function deactivate() {}

module.exports = { activate, deactivate };
