'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { applyPatch, inspectInstallation } = require('../src/patcher');

const originalCatch = 'catch(e){if(K.warning(`heartbeat_automation_resume_failed`,{safe:{threadId:t},sensitive:{error:e}}),MS(e)){f.current.add(t);return}!i&&p.current==null&&(p.current=setTimeout(()=>{p.current=null,c(e=>e+1)},750))}finally';
const patchedStart = 'catch(e){/* codex-goal-retry:begin */';
const patchedEnd = '/* codex-goal-retry:end */}finally';
const shortRetryDelayMs = 750;

function extractPatchedCatch(content) {
  const start = content.indexOf(patchedStart);
  const end = content.indexOf(patchedEnd, start);
  if (start < 0 || end < 0) {
    throw new Error('Could not extract patched catch block from fake Codex bundle.');
  }
  return content.slice(start, end + patchedEnd.length);
}

function createVmSource(catchClause) {
  return [
    "'use strict';",
    'globalThis.__createHarness = function() {',
    '  delete globalThis.__codexGoalRetryLongTimers;',
    '  const warnings = [];',
    '  const timers = [];',
    '  const K = {',
    '    warning(name, payload) {',
    '      warnings.push({ name, payload });',
    '    }',
    '  };',
    "  const t = 'thread-1';",
    '  const f = { current: new Set() };',
    '  const p = { current: null };',
    '  let i = false;',
    '  let renderCount = 0;',
    '  function c(update) {',
    "    renderCount = typeof update === 'function' ? update(renderCount) : update;",
    '  }',
    '  function MS(error) {',
    '    return Boolean(error && error.terminal);',
    '  }',
    '  function setTimeout(callback, delay) {',
    '    const timer = { callback, delay, active: true };',
    '    timers.push(timer);',
    '    return timer;',
    '  }',
    '  function trigger(error) {',
    '    try {',
    '      throw error;',
    `    } ${catchClause} {`,
    '    }',
    '  }',
    '  function runTimer(delay) {',
    '    const timer = timers.find((item) => item.delay === delay && item.active);',
    '    if (!timer) {',
    '      throw new Error(`No active timer with delay ${delay}`);',
    '    }',
    '    timer.active = false;',
    '    timer.callback();',
    '  }',
    '  return {',
    '    trigger,',
    '    runTimer,',
    '    markGoalResolved() {',
    '      i = true;',
    '    },',
    '    snapshot() {',
    '      return {',
    '        renderCount,',
    '        failedThread: f.current.has(t),',
    '        warningCount: warnings.length,',
    '        warningNames: warnings.map((item) => item.name),',
    '        pCurrentDelay: p.current ? p.current.delay : null,',
    '        activeDelays: timers.filter((item) => item.active).map((item) => item.delay).sort((left, right) => left - right),',
    '        longTimerCount: globalThis.__codexGoalRetryLongTimers ? globalThis.__codexGoalRetryLongTimers.size : 0',
    '      };',
    '    }',
    '  };',
    '};'
  ].join('\n');
}

function plainSnapshot(harness) {
  return JSON.parse(JSON.stringify(harness.snapshot()));
}

function createHarness(catchClause) {
  const context = vm.createContext({});
  vm.runInContext(createVmSource(catchClause), context);
  return context.__createHarness();
}

function prepareFakeCodexExtension(intervalMinutes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-goal-retry-scenario-'));
  fs.mkdirSync(path.join(root, 'webview', 'assets'), { recursive: true });
  fs.mkdirSync(path.join(root, 'out'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'chatgpt', publisher: 'openai', version: 'scenario' }, null, 2));
  fs.writeFileSync(path.join(root, 'out', 'extension.js'), 'const retry = "Tp=3,y6e=300,v6e=2e3 shouldRetryStatus";');
  fs.writeFileSync(path.join(root, 'webview', 'assets', 'app-main-scenario.js'), `prefix maybe-resume-conversation ${originalCatch} suffix`);

  const applied = applyPatch(root, { intervalMinutes });
  assert.strictEqual(applied.after.status, 'patched');

  const asset = fs.readFileSync(path.join(root, 'webview', 'assets', 'app-main-scenario.js'), 'utf8');
  const report = inspectInstallation(root);
  return { root, catchClause: extractPatchedCatch(asset), report };
}

function assertWarning(snapshot) {
  assert(snapshot.warningNames.every((name) => name === 'heartbeat_automation_resume_failed'));
}

function runScenario(intervalMinutes) {
  const longRetryDelayMs = intervalMinutes * 60 * 1000;
  const fakeCodex = prepareFakeCodexExtension(intervalMinutes);

  try {
    const terminalFailure = createHarness(fakeCodex.catchClause);
    terminalFailure.trigger({ terminal: true });
    terminalFailure.trigger({ terminal: true });
    let snapshot = plainSnapshot(terminalFailure);
    assert.strictEqual(snapshot.warningCount, 2);
    assertWarning(snapshot);
    assert.strictEqual(snapshot.failedThread, true);
    assert.deepStrictEqual(snapshot.activeDelays, [longRetryDelayMs]);
    assert.strictEqual(snapshot.longTimerCount, 1);
    assert.strictEqual(snapshot.renderCount, 0);

    terminalFailure.runTimer(longRetryDelayMs);
    snapshot = plainSnapshot(terminalFailure);
    assert.strictEqual(snapshot.failedThread, false);
    assert.strictEqual(snapshot.longTimerCount, 0);
    assert.strictEqual(snapshot.renderCount, 1);

    const normalFailure = createHarness(fakeCodex.catchClause);
    normalFailure.trigger({ terminal: false });
    snapshot = plainSnapshot(normalFailure);
    assert.strictEqual(snapshot.warningCount, 1);
    assertWarning(snapshot);
    assert.strictEqual(snapshot.failedThread, false);
    assert.deepStrictEqual(snapshot.activeDelays, [shortRetryDelayMs, longRetryDelayMs]);
    assert.strictEqual(snapshot.pCurrentDelay, shortRetryDelayMs);

    normalFailure.runTimer(shortRetryDelayMs);
    snapshot = plainSnapshot(normalFailure);
    assert.strictEqual(snapshot.renderCount, 1);
    assert.strictEqual(snapshot.pCurrentDelay, null);
    assert.deepStrictEqual(snapshot.activeDelays, [longRetryDelayMs]);

    normalFailure.runTimer(longRetryDelayMs);
    snapshot = plainSnapshot(normalFailure);
    assert.strictEqual(snapshot.renderCount, 2);
    assert.strictEqual(snapshot.longTimerCount, 0);

    const resolvedGoal = createHarness(fakeCodex.catchClause);
    resolvedGoal.trigger({ terminal: true });
    resolvedGoal.markGoalResolved();
    resolvedGoal.runTimer(longRetryDelayMs);
    snapshot = plainSnapshot(resolvedGoal);
    assert.strictEqual(snapshot.failedThread, false);
    assert.strictEqual(snapshot.renderCount, 0);

    console.log('retry scenario passed');
    console.log(`patched status: ${fakeCodex.report.status}`);
    console.log(`long retry delay: ${longRetryDelayMs} ms (${intervalMinutes} minutes)`);
    console.log('terminal goal failure: schedules one deduplicated long retry, clears failed-thread marker, triggers resume');
    console.log('normal failure: preserves built-in 750 ms retry and also schedules long retry');
    console.log('resolved goal: long timer does not trigger resume when goal is already resolved');
  } finally {
    fs.rmSync(fakeCodex.root, { recursive: true, force: true });
  }
}

const intervalMinutes = Number(process.argv[2] || 5);
runScenario(intervalMinutes);
