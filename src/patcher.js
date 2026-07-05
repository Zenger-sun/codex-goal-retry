'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_INTERVAL_MINUTES = 5;
const ALLOWED_INTERVAL_MINUTES = new Set([5, 10, 30]);

const MARKER_BEGIN = '/* codex-goal-retry:begin */';
const MARKER_END = '/* codex-goal-retry:end */';
const PATCHED_START = `catch(e){${MARKER_BEGIN}`;
const PATCHED_END = `${MARKER_END}}finally`;

const ORIGINAL_CATCH = 'catch(e){if(K.warning(`heartbeat_automation_resume_failed`,{safe:{threadId:t},sensitive:{error:e}}),MS(e)){f.current.add(t);return}!i&&p.current==null&&(p.current=setTimeout(()=>{p.current=null,c(e=>e+1)},750))}finally';

function patchedCatch(delayMs) {
  return `catch(e){${MARKER_BEGIN}K.warning(\`heartbeat_automation_resume_failed\`,{safe:{threadId:t},sensitive:{error:e}});let __cgrTimers=globalThis.__codexGoalRetryLongTimers??(globalThis.__codexGoalRetryLongTimers=new Map),__cgrSchedule=()=>{__cgrTimers.has(t)||__cgrTimers.set(t,setTimeout(()=>{__cgrTimers.delete(t),f.current.delete(t),p.current=null,!i&&c(e=>e+1)},${delayMs}))};if(MS(e)){f.current.add(t);__cgrSchedule();return}!i&&p.current==null&&(p.current=setTimeout(()=>{p.current=null,c(e=>e+1)},750));__cgrSchedule()${MARKER_END}}finally`;
}

function normalizeIntervalMinutes(value) {
  const minutes = Number(value ?? DEFAULT_INTERVAL_MINUTES);
  if (!Number.isFinite(minutes) || !ALLOWED_INTERVAL_MINUTES.has(minutes)) {
    throw new Error(`Invalid retry interval: ${value}. Allowed values are 5, 10, and 30 minutes.`);
  }
  return minutes;
}

function intervalToDelayMs(intervalMinutes) {
  return normalizeIntervalMinutes(intervalMinutes) * 60 * 1000;
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function readPackage(extensionPath) {
  const packagePath = path.join(extensionPath, 'package.json');
  if (!fs.existsSync(packagePath)) {
    return null;
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return {
      name: pkg.name,
      publisher: pkg.publisher,
      version: pkg.version,
      displayName: pkg.displayName,
      engines: pkg.engines
    };
  } catch (error) {
    return { error: String(error) };
  }
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const result = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        result.push(fullPath);
      }
    }
  }
  return result;
}

function findHeartbeatAsset(extensionPath) {
  const assetsDir = path.join(extensionPath, 'webview', 'assets');
  const candidates = listFiles(assetsDir)
    .filter((file) => file.endsWith('.js'))
    .sort((left, right) => {
      const leftName = path.basename(left);
      const rightName = path.basename(right);
      const leftScore = leftName.startsWith('app-main-') ? 0 : 1;
      const rightScore = rightName.startsWith('app-main-') ? 0 : 1;
      return leftScore - rightScore || leftName.localeCompare(rightName);
    });

  for (const file of candidates) {
    const name = path.basename(file);
    if (!name.startsWith('app-main-') && !name.includes('automation') && !name.includes('conversation')) {
      continue;
    }

    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('heartbeat_automation_resume_failed') && content.includes('maybe-resume-conversation')) {
      return { file, content };
    }
  }

  return null;
}

function inspectGenericRetryLayer(extensionPath) {
  const file = path.join(extensionPath, 'out', 'extension.js');
  if (!fs.existsSync(file)) {
    return { exists: false, file };
  }

  const content = fs.readFileSync(file, 'utf8');
  return {
    exists: true,
    file,
    sha256: sha256(content),
    containsKnownRetryConstants: content.includes('Tp=3,y6e=300,v6e=2e3') || content.includes('shouldRetryStatus'),
    note: 'This tool only inspects this file. It never writes the generic HTTP/stream retry layer.'
  };
}

function getPatchedRange(content) {
  const start = content.indexOf(PATCHED_START);
  if (start < 0) {
    return null;
  }

  const end = content.indexOf(PATCHED_END, start);
  if (end < 0) {
    throw new Error('Found Codex Goal Retry marker begin without marker end. Refusing to edit.');
  }

  return { start, end: end + PATCHED_END.length };
}

function detectPatch(content) {
  const patchedRange = getPatchedRange(content);
  if (patchedRange) {
    const block = content.slice(patchedRange.start, patchedRange.end);
    const delayMatch = block.match(/setTimeout\(\(\)=>\{__cgrTimers\.delete\(t\),f\.current\.delete\(t\),p\.current=null,!i&&c\(e=>e\+1\)\},(\d+)\)/);
    return {
      status: 'patched',
      delayMs: delayMatch ? Number(delayMatch[1]) : null,
      preservesShortRetry: block.includes('setTimeout(()=>{p.current=null,c(e=>e+1)},750)'),
      preservesFailedThreadMark: block.includes('f.current.add(t)'),
      hasOriginalSignature: content.includes(ORIGINAL_CATCH)
    };
  }

  if (content.includes(ORIGINAL_CATCH)) {
    return {
      status: 'supported-original',
      delayMs: null,
      preservesShortRetry: true,
      preservesFailedThreadMark: true,
      hasOriginalSignature: true
    };
  }

  if (content.includes('heartbeat_automation_resume_failed')) {
    return {
      status: 'unsupported-signature',
      delayMs: null,
      preservesShortRetry: content.includes('setTimeout(()=>{p.current=null,c(e=>e+1)},750)'),
      preservesFailedThreadMark: content.includes('f.current.add(t)'),
      hasOriginalSignature: false
    };
  }

  return {
    status: 'not-found',
    delayMs: null,
    preservesShortRetry: false,
    preservesFailedThreadMark: false,
    hasOriginalSignature: false
  };
}

function assertInside(root, file) {
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(file);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to edit outside Codex extension directory: ${resolvedFile}`);
  }
}

function createBackup(extensionPath, file, content) {
  assertInside(extensionPath, file);
  const backupDir = path.join(extensionPath, '.codex-goal-retry-backups');
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const digest = sha256(content).slice(0, 12);
  const backupFile = path.join(backupDir, `${path.basename(file)}.${stamp}.${digest}.bak`);
  fs.writeFileSync(backupFile, content, 'utf8');
  return backupFile;
}

function replacePatchedBlock(content, replacement) {
  const range = getPatchedRange(content);
  if (!range) {
    return null;
  }
  return content.slice(0, range.start) + replacement + content.slice(range.end);
}

function inspectInstallation(extensionPath) {
  const resolvedPath = path.resolve(extensionPath);
  const pkg = readPackage(resolvedPath);
  const heartbeatAsset = findHeartbeatAsset(resolvedPath);
  const genericRetryLayer = inspectGenericRetryLayer(resolvedPath);

  if (!heartbeatAsset) {
    return {
      extensionPath: resolvedPath,
      package: pkg,
      assetFile: null,
      status: 'not-found',
      delayMs: null,
      sha256: null,
      genericRetryLayer
    };
  }

  const detection = detectPatch(heartbeatAsset.content);
  return {
    extensionPath: resolvedPath,
    package: pkg,
    assetFile: heartbeatAsset.file,
    status: detection.status,
    delayMs: detection.delayMs,
    preservesShortRetry: detection.preservesShortRetry,
    preservesFailedThreadMark: detection.preservesFailedThreadMark,
    hasOriginalSignature: detection.hasOriginalSignature,
    sha256: sha256(heartbeatAsset.content),
    genericRetryLayer
  };
}

function applyPatch(extensionPath, options = {}) {
  const delayMs = intervalToDelayMs(options.intervalMinutes);
  const report = inspectInstallation(extensionPath);
  if (!report.assetFile) {
    throw new Error('Could not find the Codex heartbeat automation webview asset.');
  }

  assertInside(report.extensionPath, report.assetFile);
  const content = fs.readFileSync(report.assetFile, 'utf8');
  const detection = detectPatch(content);
  let nextContent;
  let backupFile = null;

  if (detection.status === 'patched') {
    nextContent = replacePatchedBlock(content, patchedCatch(delayMs));
  } else if (detection.status === 'supported-original') {
    backupFile = createBackup(report.extensionPath, report.assetFile, content);
    nextContent = content.replace(ORIGINAL_CATCH, patchedCatch(delayMs));
  } else {
    throw new Error(`Unsupported Codex bundle signature: ${detection.status}. No files were changed.`);
  }

  if (nextContent == null) {
    throw new Error('Failed to build patched Codex bundle content. No files were changed.');
  }

  const changed = nextContent !== content;
  if (changed) {
    fs.writeFileSync(report.assetFile, nextContent, 'utf8');
  }

  return {
    changed,
    backupFile,
    delayMs,
    before: report,
    after: inspectInstallation(extensionPath)
  };
}

function restorePatch(extensionPath) {
  const report = inspectInstallation(extensionPath);
  if (!report.assetFile) {
    throw new Error('Could not find the Codex heartbeat automation webview asset.');
  }

  assertInside(report.extensionPath, report.assetFile);
  const content = fs.readFileSync(report.assetFile, 'utf8');
  const detection = detectPatch(content);
  if (detection.status === 'supported-original') {
    return { changed: false, backupFile: null, before: report, after: report };
  }
  if (detection.status !== 'patched') {
    throw new Error(`Codex bundle is not patched by this tool: ${detection.status}. No files were changed.`);
  }

  const backupFile = createBackup(report.extensionPath, report.assetFile, content);
  const nextContent = replacePatchedBlock(content, ORIGINAL_CATCH);
  if (nextContent == null) {
    throw new Error('Failed to restore Codex bundle content. No files were changed.');
  }

  fs.writeFileSync(report.assetFile, nextContent, 'utf8');
  return {
    changed: true,
    backupFile,
    before: report,
    after: inspectInstallation(extensionPath)
  };
}

function formatReport(report) {
  const pkg = report.package || {};
  const lines = [];
  lines.push(`Codex extension path: ${report.extensionPath}`);
  lines.push(`Codex extension version: ${pkg.version || 'unknown'}`);
  lines.push(`Heartbeat asset: ${report.assetFile || 'not found'}`);
  lines.push(`Goal retry patch status: ${report.status}`);
  lines.push(`Long retry delay: ${report.delayMs == null ? 'not installed' : `${report.delayMs} ms`}`);
  lines.push(`Preserves built-in 750ms retry: ${report.preservesShortRetry ? 'yes' : 'unknown/no'}`);
  lines.push(`Preserves failed-thread marker path: ${report.preservesFailedThreadMark ? 'yes' : 'unknown/no'}`);
  lines.push(`Heartbeat asset SHA-256: ${report.sha256 || 'unknown'}`);
  lines.push(`Generic HTTP/stream retry layer: ${report.genericRetryLayer.exists ? 'detected and left untouched' : 'not found'}`);
  if (report.genericRetryLayer.exists) {
    lines.push(`Generic retry asset SHA-256: ${report.genericRetryLayer.sha256}`);
  }
  return lines.join('\n');
}

module.exports = {
  DEFAULT_INTERVAL_MINUTES,
  ALLOWED_INTERVAL_MINUTES,
  intervalToDelayMs,
  inspectInstallation,
  applyPatch,
  restorePatch,
  formatReport
};


