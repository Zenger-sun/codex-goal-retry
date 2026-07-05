'use strict';

const fs = require('fs');
const path = require('path');
const { inspectInstallation, formatReport } = require('../src/patcher');

function defaultExtensionsDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.USERPROFILE || '', '.vscode', 'extensions');
  }
  return path.join(process.env.HOME || '', '.vscode', 'extensions');
}

function guessCodexExtensionPath() {
  const extensionsDir = defaultExtensionsDir();
  if (!fs.existsSync(extensionsDir)) {
    return null;
  }

  const candidates = fs.readdirSync(extensionsDir)
    .filter((name) => name.startsWith('openai.chatgpt-'))
    .sort();
  if (candidates.length === 0) {
    return null;
  }

  return path.join(extensionsDir, candidates[candidates.length - 1]);
}

const target = process.argv[2] || process.env.CODEX_EXTENSION_PATH || guessCodexExtensionPath();
if (!target) {
  console.error('Could not locate OpenAI Codex VS Code extension. Pass the extension path as the first argument or set CODEX_EXTENSION_PATH.');
  process.exit(1);
}

const report = inspectInstallation(target);
console.log(formatReport(report));
console.log('\nJSON report:');
console.log(JSON.stringify(report, null, 2));

if (report.status === 'unsupported-signature' || report.status === 'not-found') {
  process.exit(2);
}
