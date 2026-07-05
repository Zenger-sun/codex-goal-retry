# Design Notes

## Why a companion extension

The published OpenAI Codex VS Code extension is distributed as bundled JavaScript plus a native `codex.exe`. The local install does not include source maps for the webview bundle, so this project avoids republishing OpenAI code and instead provides a small companion extension that can inspect, patch, and restore a narrow goal/heartbeat runtime signature.

## Patch target

The target is the webview bundle containing both strings:

- `heartbeat_automation_resume_failed`
- `maybe-resume-conversation`

For Codex `26.623.101652`, that logic is in `webview/assets/app-main-*.js` and belongs to the heartbeat automation resume loop.

Original behavior in the minified bundle:

```js
catch(e){if(K.warning(`heartbeat_automation_resume_failed`,{safe:{threadId:t},sensitive:{error:e}}),MS(e)){f.current.add(t);return}!i&&p.current==null&&(p.current=setTimeout(()=>{p.current=null,c(e=>e+1)},750))}finally
```

Patched behavior keeps the original short path and adds a long path:

```js
catch(e){
  K.warning(...);
  const scheduleLongRetry = () => {
    // One long timer per thread. Defaults to 5 minutes, configurable to 10 or 30.
    setTimeout(() => {
      failedThreadSet.delete(threadId);
      shortRetryRef.current = null;
      rerender();
    }, configuredDelayMs);
  };

  if (isNoRolloutFoundForThread(error)) {
    failedThreadSet.add(threadId);
    scheduleLongRetry();
    return;
  }

  keepBuiltin750msShortRetry();
  scheduleLongRetry();
} finally
```

The actual patch keeps the bundled variable names and inserts explicit `codex-goal-retry` markers so it can be restored safely.

## Non-goals

- Do not edit generic HTTP or streaming retry code.
- Do not retry every Codex request.
- Do not install or patch automatically.
- Do not modify the native `codex.exe` binary.

## Compatibility strategy

The patcher uses exact-string matching and explicit begin/end markers. If the original signature is missing and no marker is present, it refuses to write. This makes OpenAI bundle updates fail closed rather than silently editing unrelated code.
