'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { applyPatch, inspectInstallation, restorePatch } = require('../src/patcher');

const originalCatch = 'catch(e){if(K.warning(`heartbeat_automation_resume_failed`,{safe:{threadId:t},sensitive:{error:e}}),MS(e)){f.current.add(t);return}!i&&p.current==null&&(p.current=setTimeout(()=>{p.current=null,c(e=>e+1)},750))}finally';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-goal-retry-'));
try {
  fs.mkdirSync(path.join(root, 'webview', 'assets'), { recursive: true });
  fs.mkdirSync(path.join(root, 'out'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'chatgpt', publisher: 'openai', version: 'test' }, null, 2));
  fs.writeFileSync(path.join(root, 'out', 'extension.js'), 'const retry = "Tp=3,y6e=300,v6e=2e3 shouldRetryStatus";');
  fs.writeFileSync(path.join(root, 'webview', 'assets', 'app-main-test.js'), `prefix maybe-resume-conversation ${originalCatch} suffix`);

  const before = inspectInstallation(root);
  assert.strictEqual(before.status, 'supported-original');
  assert.strictEqual(before.delayMs, null);
  assert.strictEqual(before.preservesShortRetry, true);
  assert.strictEqual(before.preservesFailedThreadMark, true);

  const applied = applyPatch(root, { intervalMinutes: 10 });
  assert.strictEqual(applied.changed, true);
  assert.strictEqual(applied.after.status, 'patched');
  assert.strictEqual(applied.after.delayMs, 600000);
  assert.strictEqual(applied.after.preservesShortRetry, true);
  assert.strictEqual(applied.after.preservesFailedThreadMark, true);

  const genericLayer = fs.readFileSync(path.join(root, 'out', 'extension.js'), 'utf8');
  assert(!genericLayer.includes('codex-goal-retry'), 'generic HTTP/stream retry layer should not be patched');

  const restored = restorePatch(root);
  assert.strictEqual(restored.changed, true);
  assert.strictEqual(restored.after.status, 'supported-original');
  assert.strictEqual(restored.after.delayMs, null);

  console.log('self-test passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
