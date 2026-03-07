# Copilot CLI Patch: Sync Sub-Agent Timeout + Exponential Backoff Retry

## Problem

When the Copilot CLI's main orchestrator agent calls a sub-agent in **sync mode** (via the `task` tool), the `await` on the sub-agent result has **no timeout and no retry logic**. If the sub-agent takes too long (typically 5+ minutes for complex multi-file edits with Opus), the server-side API connection can reset or the parent agent's turn can be interrupted. This manifests as:

- The tool returning `"The execution of this tool, or a previous tool was interrupted."`
- The orchestrator appearing "hung" to the user
- Partial work potentially lost with no retry attempt

## Root Cause Analysis

### File
`~/.copilot/pkg/linux-arm64/0.0.421/index.js` (minified, single-line JS bundle)

### Code Path
The sync task execution happens in the task tool callback. The relevant code is at **byte offset ~10273316**:

```javascript
let de=h?()=>h.enqueue(T):T;
try{
  let oe=await de(),  // ← blocks indefinitely, no timeout
  Ie={agent_type:__(k),execution_mode:"sync"};
  return z&&(Ie.model=z),L&&L!==z&&(Ie.resolved_model=L),
    {...oe,toolTelemetry:{...oe.toolTelemetry,properties:{...oe.toolTelemetry?.properties,...Ie}}}
}catch(oe){
  let Ie=be(oe);
  e.error(`Task tool error for agent_type ${k}: ${Ie}`);
  let ee={agent_type:__(k),execution_mode:"sync"};
  return z&&(ee.model=z),L&&L!==z&&(ee.resolved_model=L),
    {textResultForLlm:`Task tool encountered an error: ${Ie}`,resultType:"failure",error:Ie,
     toolTelemetry:{properties:ee,restrictedProperties:{agent_type:k,error:Ie},metrics:{}}}
}
```

### Architecture Context
- The Go binary (`/usr/local/bin/copilot`) launches a Node.js process using `index.js`
- `index.js` contains the full CLI runtime: agent loop, tool definitions, sub-agent execution, Anthropic SDK
- Sub-agent types: `explore` (Haiku), `task` (Haiku), `general-purpose` (Sonnet), `code-review`, and custom agents
- The sub-agent's own agentic loop (`for(;;)` at byte ~11160800) has `max_tokens: 8192` per turn, uses streaming, and has no turn limit
- Background mode uses a registry with `read_agent` polling (300s max wait) — this works fine
- **Only sync mode is affected** because it does a bare `await` with no timeout wrapper

### Key Variables in Scope
| Variable | Purpose |
|----------|---------|
| `h` | Execution queue (if present, serializes execution) |
| `T` | The sub-agent execution function |
| `de` | Either `T` directly or `() => h.enqueue(T)` (queued version) |
| `k` | Agent type string (e.g., "rigor_plugin_producer") |
| `z` | Model override (if specified) |
| `L` | Resolved model |
| `e` | Logger |
| `be()` | Error-to-string utility |
| `__()` | Agent type formatter |

### Other Relevant Discoveries
- **Anthropic SDK client timeout:** `600000ms` (10 min) for both streaming and non-streaming calls
- **Sub-agent loop:** No iteration/turn limit — runs until `stop_reason === "end_turn"` or `"max_tokens"`
- **Existing patch:** At byte ~263864, `Ce("node:assert")` was replaced with a soft assertion function. This patch is independent and must be preserved.
- **Bottleneck rate limiter:** Embedded in the bundle for queue management, not related to this issue.

## The Patch

### What It Does
1. **Wraps the sync `await` with a timeout** using `AbortController` + `Promise.race`
2. **Retries with exponential backoff** on timeout: `base_timeout × 2^attempt`
3. **Configurable via environment variables:**
   - `COPILOT_AGENT_TIMEOUT_MS` — base timeout in milliseconds (default: `600000` = 10 min)
   - `COPILOT_AGENT_MAX_RETRIES` — maximum retry attempts (default: `2`, so up to 3 total attempts)
4. **Backoff schedule** (with defaults): 10min → 20min → 40min
5. **Preserves existing error handling** — if all retries exhausted, returns the same error response format

### Exact String to Find
```
let de=h?()=>h.enqueue(T):T;try{let oe=await de(),Ie={agent_type:__(k),execution_mode:"sync"};return z&&(Ie.model=z),L&&L!==z&&(Ie.resolved_model=L),{...oe,toolTelemetry:{...oe.toolTelemetry,properties:{...oe.toolTelemetry?.properties,...Ie}}}}catch(oe){let Ie=be(oe);e.error(`Task tool error for agent_type ${k}: ${Ie}`);let ee={agent_type:__(k),execution_mode:"sync"};return z&&(ee.model=z),L&&L!==z&&(ee.resolved_model=L),{textResultForLlm:`Task tool encountered an error: ${Ie}`,resultType:"failure",error:Ie,toolTelemetry:{properties:ee,restrictedProperties:{agent_type:k,error:Ie},metrics:{}}}}
```

### Exact Replacement String
```
let de=h?()=>h.enqueue(T):T;{const _SYNC_TIMEOUT=parseInt(process.env.COPILOT_AGENT_TIMEOUT_MS||"600000",10),_MAX_RETRIES=parseInt(process.env.COPILOT_AGENT_MAX_RETRIES||"2",10);let _attempt=0;for(;;){try{const _ac=new AbortController,_tid=setTimeout(()=>_ac.abort(),_SYNC_TIMEOUT*Math.pow(2,_attempt));let oe=await Promise.race([de(),new Promise((_,rej)=>{_ac.signal.addEventListener("abort",()=>rej(new Error("SYNC_AGENT_TIMEOUT")))})]);clearTimeout(_tid);let Ie={agent_type:__(k),execution_mode:"sync"};return z&&(Ie.model=z),L&&L!==z&&(Ie.resolved_model=L),{...oe,toolTelemetry:{...oe.toolTelemetry,properties:{...oe.toolTelemetry?.properties,...Ie}}}}catch(oe){if(oe?.message==="SYNC_AGENT_TIMEOUT"&&_attempt<_MAX_RETRIES){_attempt++;e.info(`Sync agent timed out after ${_SYNC_TIMEOUT*Math.pow(2,_attempt-1)}ms, retry ${_attempt}/${_MAX_RETRIES} with backoff`);continue}let Ie=be(oe);e.error(`Task tool error for agent_type ${k}: ${Ie}`);let ee={agent_type:__(k),execution_mode:"sync"};return z&&(ee.model=z),L&&L!==z&&(ee.resolved_model=L),{textResultForLlm:`Task tool encountered an error: ${Ie}`,resultType:"failure",error:Ie,toolTelemetry:{properties:ee,restrictedProperties:{agent_type:k,error:Ie},metrics:{}}}}}}
```

### Apply Script (Node.js)

Save this as `apply-patch.js` and run with `node apply-patch.js`:

```javascript
const fs = require('fs');

// Adjust this path for your platform/version
const INDEX_PATH = process.env.COPILOT_INDEX_PATH
  || `${process.env.HOME}/.copilot/pkg/linux-arm64/0.0.421/index.js`;

const BACKUP_SUFFIX = '.pre-timeout-patch.bak';

// Read the file
let code = fs.readFileSync(INDEX_PATH, 'utf-8');

// The exact string to find (sync task execution block — no timeout, no retry)
const oldCode = [
  'let de=h?()=>h.enqueue(T):T;',
  'try{let oe=await de(),',
  'Ie={agent_type:__(k),execution_mode:"sync"};',
  'return z&&(Ie.model=z),L&&L!==z&&(Ie.resolved_model=L),',
  '{...oe,toolTelemetry:{...oe.toolTelemetry,properties:{...oe.toolTelemetry?.properties,...Ie}}}}',
  'catch(oe){let Ie=be(oe);',
  'e.error(`Task tool error for agent_type ${k}: ${Ie}`);',
  'let ee={agent_type:__(k),execution_mode:"sync"};',
  'return z&&(ee.model=z),L&&L!==z&&(ee.resolved_model=L),',
  '{textResultForLlm:`Task tool encountered an error: ${Ie}`,',
  'resultType:"failure",error:Ie,',
  'toolTelemetry:{properties:ee,restrictedProperties:{agent_type:k,error:Ie},metrics:{}}}}'
].join('');

// The replacement: timeout + exponential backoff retry
const newCode = [
  'let de=h?()=>h.enqueue(T):T;',
  '{const _SYNC_TIMEOUT=parseInt(process.env.COPILOT_AGENT_TIMEOUT_MS||"600000",10),',
  '_MAX_RETRIES=parseInt(process.env.COPILOT_AGENT_MAX_RETRIES||"2",10);',
  'let _attempt=0;for(;;){',
  'try{',
  'const _ac=new AbortController,',
  '_tid=setTimeout(()=>_ac.abort(),_SYNC_TIMEOUT*Math.pow(2,_attempt));',
  'let oe=await Promise.race([de(),',
  'new Promise((_,rej)=>{_ac.signal.addEventListener("abort",',
  '()=>rej(new Error("SYNC_AGENT_TIMEOUT")))})]);',
  'clearTimeout(_tid);',
  'let Ie={agent_type:__(k),execution_mode:"sync"};',
  'return z&&(Ie.model=z),L&&L!==z&&(Ie.resolved_model=L),',
  '{...oe,toolTelemetry:{...oe.toolTelemetry,properties:{...oe.toolTelemetry?.properties,...Ie}}}}',
  'catch(oe){',
  'if(oe?.message==="SYNC_AGENT_TIMEOUT"&&_attempt<_MAX_RETRIES)',
  '{_attempt++;',
  'e.info(`Sync agent timed out after ${_SYNC_TIMEOUT*Math.pow(2,_attempt-1)}ms, ',
  'retry ${_attempt}/${_MAX_RETRIES} with backoff`);continue}',
  'let Ie=be(oe);',
  'e.error(`Task tool error for agent_type ${k}: ${Ie}`);',
  'let ee={agent_type:__(k),execution_mode:"sync"};',
  'return z&&(ee.model=z),L&&L!==z&&(ee.resolved_model=L),',
  '{textResultForLlm:`Task tool encountered an error: ${Ie}`,',
  'resultType:"failure",error:Ie,',
  'toolTelemetry:{properties:ee,restrictedProperties:{agent_type:k,error:Ie},metrics:{}}}}}}'
].join('');

// Verify the old code exists
if (!code.includes(oldCode)) {
  // Check if already patched
  if (code.includes('SYNC_AGENT_TIMEOUT')) {
    console.log("Already patched — SYNC_AGENT_TIMEOUT found in code.");
    process.exit(0);
  }
  console.error("ERROR: Could not find the target code block.");
  console.error("The file structure may have changed in a newer version.");
  process.exit(1);
}

// Backup
const backupPath = INDEX_PATH + BACKUP_SUFFIX;
if (!fs.existsSync(backupPath)) {
  fs.copyFileSync(INDEX_PATH, backupPath);
  console.log(`Backup saved to: ${backupPath}`);
}

// Apply
code = code.replace(oldCode, newCode);
fs.writeFileSync(INDEX_PATH, code);

console.log("Patch applied successfully.");
console.log("");
console.log("Configuration (via environment variables):");
console.log("  COPILOT_AGENT_TIMEOUT_MS   Base timeout in ms (default: 600000 = 10 min)");
console.log("  COPILOT_AGENT_MAX_RETRIES  Max retry attempts (default: 2)");
console.log("");
console.log("Backoff schedule with defaults: 10min → 20min → 40min");
console.log("");
console.log("Restart the Copilot CLI for the patch to take effect.");
```

### Revert Script

```javascript
const fs = require('fs');
const INDEX_PATH = process.env.COPILOT_INDEX_PATH
  || `${process.env.HOME}/.copilot/pkg/linux-arm64/0.0.421/index.js`;
const backupPath = INDEX_PATH + '.pre-timeout-patch.bak';
if (fs.existsSync(backupPath)) {
  fs.copyFileSync(backupPath, INDEX_PATH);
  console.log("Reverted to pre-patch backup.");
} else {
  console.error("No backup found at: " + backupPath);
}
```

## Risks and Limitations

| Risk | Mitigation |
|------|------------|
| Sub-agent partially edits files before timeout | Sub-agents target idempotent end states — re-running reaches the same result. Producer agents check file state before editing. |
| `de()` is queued (`h.enqueue(T)`) — `Promise.race` doesn't cancel the queued task | The timeout only prevents the parent from blocking forever. The queued task may still complete in the background. For sync mode, this is acceptable — the parent returns an error and can retry. |
| Retry calls `de()` again, which re-runs the entire sub-agent | This is intentional — the sub-agent is stateless and re-reads files fresh on each run. |
| Patch breaks on future CLI versions | The find-string is version-specific. The apply script validates the target exists and aborts cleanly if not found. |
| Existing assert patch at byte ~263864 | Completely independent (10M bytes apart). Not affected. |

## Version Info
- CLI version: `0.0.421`
- Platform: `linux-arm64`
- File: `~/.copilot/pkg/linux-arm64/0.0.421/index.js`
- File size before patch: `16253013` bytes
- Patch location: byte offset `~10273316`
