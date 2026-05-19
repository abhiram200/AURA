# Managed Shell System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AI-managed background shell execution to the AURA builder — the AI can spawn, monitor, and terminate background shells; the UI shows active shells in the top bar and inline in chat.

**Architecture:** New `ManagedShellService` on the server manages pty-spawned shells with file-backed output logs. Four new agent tools (`shell_spawn`, `shell_read`, `shell_terminate`, `shell_list`) give the AI control. SSE events stream shell state to the frontend. A new `useManagedShells` hook + components render active shells in the header badge and chat.

**Tech Stack:** TypeScript, Express 5, node-pty, WebSocket, xterm.js, React 19 hooks, SSE streaming

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `server/services/managedShell.ts` | ManagedShellService — spawn, track, read, terminate background shells |
| Create | `server/routes/managedShell.ts` | REST routes for managed shell state (list, output, terminate) |
| Modify | `server/services/aura/agent.ts` | Add 4 shell tools, pass ManagedShellService to AuraAgent |
| Modify | `server/services/aura/sse.ts` | Add ShellSpawned, ShellOutput, ShellExited, ShellTerminated event types |
| Modify | `server/index.ts` | Instantiate ManagedShellService, mount routes, pass to aura router |
| Modify | `server/routes/aura.ts` | Pass ManagedShellService to AuraAgent for shell tools |
| Create | `src/hooks/useManagedShells.ts` | React hook for managed shell state, SSE subscription, REST API |
| Create | `src/components/aura/ManagedShellBadge.tsx` | Header badge showing active shell count, dropdown shell list |
| Create | `src/components/aura/ManagedTerminalPanel.tsx` | Read-only xterm terminal view for a managed shell |
| Create | `src/components/aura/ShellBlock.tsx` | Inline chat block for shell_spawned/tool_call events |
| Modify | `src/pages/builder/AssistantPage.tsx` | Add ManagedShellBadge to header, terminal panel view |
| Modify | `src/components/aura/AuraChat.tsx` | Render ShellBlock for shell events |
| Modify | `src/hooks/useAura.ts` | Parse shell SSE events, add shell state to messages |
| Create | `src/styles/managed-shell.css` | Styles for badge, terminal panel, shell blocks |

---

### Task 1: ManagedShellService (Backend Core)

**Files:**
- Create: `server/services/managedShell.ts`

- [ ] **Step 1: Create the ManagedShellService with full implementation**

```typescript
// server/services/managedShell.ts
import { spawn as childSpawn, type ChildProcess } from 'child_process'
import { platform } from 'os'
import { createRequire } from 'module'
import { mkdirSync, appendFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import type { ProjectService } from './project.ts'
import { EventEmitter } from 'events'

const nodeRequire = createRequire(import.meta.url)

export type ManagedShellStatus = 'running' | 'completed' | 'failed' | 'killed'

export interface ManagedShell {
  id: string
  name: string
  command: string
  cwd: string
  projectId: string
  pid?: number
  pty: any
  process?: ChildProcess
  status: ManagedShellStatus
  exitCode: number | null
  output: string        // In-memory ring buffer (last ~1MB)
  logPath: string       // Full path to log file
  createdAt: number
  finishedAt: number | null
}

export interface ShellEvent {
  type: 'shell_spawned' | 'shell_output' | 'shell_exited' | 'shell_terminated'
  shellId: string
  name?: string
  command?: string
  data?: string
  exitCode?: number
}

const MAX_BUFFER_SIZE = 1024 * 1024 // 1MB ring buffer

export class ManagedShellService extends EventEmitter {
  private projectService: ProjectService
  private shells: Map<string, ManagedShell> = new Map()
  private nextId = 1
  private ptyAvailable: boolean | null = null
  private ptyModule: any = null

  constructor(projectService: ProjectService) {
    super()
    this.projectService = projectService
  }

  private loadPty(): any {
    if (this.ptyModule) return this.ptyModule
    if (this.ptyAvailable === false) return null
    try {
      this.ptyModule = nodeRequire('node-pty')
      this.ptyAvailable = true
      return this.ptyModule
    } catch (err: any) {
      console.error('node-pty unavailable for managed shells, using child_process fallback:', err?.message || err)
      this.ptyAvailable = false
      return null
    }
  }

  async spawn(projectId: string, name: string, command: string, cwd?: string): Promise<ManagedShell> {
    const project = await this.projectService.get(projectId)
    if (!project) throw new Error(`Project not found: ${projectId}`)

    const workingDir = cwd || project.workspacePath
    const id = `shell-${this.nextId++}`
    const logDir = join(project.workspacePath, '.aura', 'shells')
    const logPath = join(logDir, `${id}.log`)

    // Ensure .aura/shells directory exists
    mkdirSync(logDir, { recursive: true })

    const shell: ManagedShell = {
      id,
      name,
      command,
      cwd: workingDir,
      projectId,
      pid: undefined,
      pty: null,
      process: undefined,
      status: 'running',
      exitCode: null,
      output: '',
      logPath,
      createdAt: Date.now(),
      finishedAt: null,
    }

    const pty = this.loadPty()
    const shellCmd = platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash')

    if (pty) {
      try {
        const ptyProcess = pty.spawn(shellCmd, [], {
          name: 'xterm-256color',
          cols: 120,
          rows: 30,
          cwd: workingDir,
          env: { ...process.env } as Record<string, string>,
        })

        shell.pty = ptyProcess
        shell.pid = ptyProcess.pid

        ptyProcess.onData((data: string) => {
          this.appendToOutput(shell, data)
          appendFileSync(logPath, data)
          this.emit('event', { type: 'shell_output', shellId: id, data } as ShellEvent)
        })

        ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
          shell.status = exitCode === 0 ? 'completed' : 'failed'
          shell.exitCode = exitCode
          shell.finishedAt = Date.now()
          this.emit('event', { type: 'shell_exited', shellId: id, exitCode, name } as ShellEvent)
        })
      } catch (err) {
        // PTY spawn failed, fall back to child_process
        this.ptyAvailable = false
        this.ptyModule = null
        this.spawnWithChildProcess(shell, shellCmd, workingDir, command)
        this.shells.set(id, shell)
        this.emit('event', { type: 'shell_spawned', shellId: id, name, command } as ShellEvent)
        return shell
      }

      // Send the command to the pty
      ptyProcess.write(command + '\n')
    } else {
      this.spawnWithChildProcess(shell, shellCmd, workingDir, command)
    }

    this.shells.set(id, shell)
    this.emit('event', { type: 'shell_spawned', shellId: id, name, command } as ShellEvent)
    return shell
  }

  private spawnWithChildProcess(shell: ManagedShell, _shellCmd: string, workingDir: string, command: string): void {
    // Use cmd /c on Windows, sh -c on Unix for direct command execution
    const isWin = platform() === 'win32'
    const child = childSpawn(
      isWin ? 'cmd' : 'sh',
      isWin ? ['/c', command] : ['-c', command],
      {
        cwd: workingDir,
        env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    )

    shell.process = child
    shell.pid = child.pid

    child.stdout?.on('data', (data: Buffer) => {
      const str = data.toString('utf-8')
      this.appendToOutput(shell, str)
      appendFileSync(shell.logPath, str)
      this.emit('event', { type: 'shell_output', shellId: shell.id, data: str } as ShellEvent)
    })

    child.stderr?.on('data', (data: Buffer) => {
      const str = data.toString('utf-8')
      this.appendToOutput(shell, str)
      appendFileSync(shell.logPath, str)
      this.emit('event', { type: 'shell_output', shellId: shell.id, data: str } as ShellEvent)
    })

    child.on('exit', (code) => {
      shell.status = code === 0 ? 'completed' : 'failed'
      shell.exitCode = code ?? 0
      shell.finishedAt = Date.now()
      this.emit('event', { type: 'shell_exited', shellId: shell.id, exitCode: code ?? 0, name: shell.name } as ShellEvent)
    })

    child.on('error', (err) => {
      const errMsg = `\r\n\x1b[31m[Shell error: ${err.message}]\x1b[0m\r\n`
      this.appendToOutput(shell, errMsg)
      appendFileSync(shell.logPath, errMsg)
      shell.status = 'failed'
      shell.exitCode = 1
      shell.finishedAt = Date.now()
      this.emit('event', { type: 'shell_exited', shellId: shell.id, exitCode: 1, name: shell.name } as ShellEvent)
    })
  }

  private appendToOutput(shell: ManagedShell, data: string): void {
    shell.output += data
    // Ring buffer: trim if exceeds max size
    if (shell.output.length > MAX_BUFFER_SIZE) {
      shell.output = shell.output.slice(shell.output.length - MAX_BUFFER_SIZE)
    }
  }

  readOutput(shellId: string, tailLines?: number): { status: ManagedShellStatus; exitCode: number | null; recentOutput: string; outputTruncated: boolean; fullLogPath?: string } | null {
    const shell = this.shells.get(shellId)
    if (!shell) return null

    let output = shell.output
    let truncated = false

    // If output was trimmed by ring buffer, the log file has more
    if (shell.output.length >= MAX_BUFFER_SIZE && existsSync(shell.logPath)) {
      truncated = true
    }

    if (tailLines && tailLines > 0) {
      const lines = output.split('\n')
      output = lines.slice(-tailLines).join('\n')
    }

    return {
      status: shell.status,
      exitCode: shell.exitCode,
      recentOutput: output,
      outputTruncated: truncated,
      fullLogPath: truncated ? shell.logPath : undefined,
    }
  }

  terminate(shellId: string): boolean {
    const shell = this.shells.get(shellId)
    if (!shell || shell.status !== 'running') return false

    if (shell.pty) {
      try { shell.pty.kill() } catch { /* already exited */ }
    } else if (shell.process) {
      shell.process.kill()
    }

    shell.status = 'killed'
    shell.exitCode = -1
    shell.finishedAt = Date.now()
    this.emit('event', { type: 'shell_terminated', shellId, name: shell.name } as ShellEvent)
    return true
  }

  listShells(projectId?: string): Array<{ id: string; name: string; command: string; status: ManagedShellStatus; exitCode: number | null; createdAt: number }> {
    const entries = [...this.shells.values()]
    if (projectId) {
      return entries.filter(s => s.projectId === projectId).map(s => ({
        id: s.id, name: s.name, command: s.command, status: s.status,
        exitCode: s.exitCode, createdAt: s.createdAt,
      }))
    }
    return entries.map(s => ({
      id: s.id, name: s.name, command: s.command, status: s.status,
      exitCode: s.exitCode, createdAt: s.createdAt,
    }))
  }

  getShell(shellId: string): ManagedShell | undefined {
    return this.shells.get(shellId)
  }

  dismissShell(shellId: string): boolean {
    const shell = this.shells.get(shellId)
    if (!shell) return false

    // Kill if still running
    if (shell.status === 'running') {
      this.terminate(shellId)
    }

    // Clean up log file
    try {
      if (existsSync(shell.logPath)) {
        unlinkSync(shell.logPath)
      }
    } catch {
      // Log file cleanup failed — non-fatal
    }

    this.shells.delete(shellId)
    return true
  }
}
```

- [ ] **Step 2: Verify the service compiles**

Run: `cd "C:/Users/abhir/Desktop/IMPORTANT/claude" && npx tsc --noEmit --project tsconfig.server.json 2>&1 | head -20`

Expected: No errors related to `managedShell.ts`. There may be pre-existing errors in other files — those are fine.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/abhir/Desktop/IMPORTANT/claude"
git add server/services/managedShell.ts
git commit -m "feat: add ManagedShellService for AI-managed background shells

Server-side service that spawns, tracks, reads, and terminates
background shell processes using node-pty with child_process fallback.
Each shell gets a 1MB in-memory ring buffer plus a file-backed log.
Emits events for SSE streaming to the frontend."
```

---

### Task 2: SSE Event Types for Shells

**Files:**
- Modify: `server/services/aura/sse.ts`

- [ ] **Step 1: Add shell event types to AgentEventType**

Add these new event types to the `AgentEventType` enum in `sse.ts`:

```typescript
export enum AgentEventType {
  Token = 'token',
  ToolCall = 'tool_call',
  ToolResult = 'tool_result',
  SubAgentStart = 'sub_agent_start',
  SubAgentResult = 'sub_agent_result',
  TodoUpdate = 'todo_update',
  ApprovalRequest = 'approval_request',
  PlanCompleted = 'plan_completed',
  Done = 'done',
  Error = 'error',
  ShellSpawned = 'shell_spawned',      // NEW
  ShellOutput = 'shell_output',          // NEW
  ShellExited = 'shell_exited',          // NEW
  ShellTerminated = 'shell_terminated',  // NEW
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd "C:/Users/abhir/Desktop/IMPORTANT/claude" && npx tsc --noEmit --project tsconfig.server.json 2>&1 | head -20`

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/abhir/Desktop/IMPORTANT/claude"
git add server/services/aura/sse.ts
git commit -m "feat: add shell SSE event types for managed shell streaming"
```

---

### Task 3: Shell Agent Tools

**Files:**
- Modify: `server/services/aura/agent.ts`

- [ ] **Step 1: Import ManagedShellService and add shell tools**

At the top of `agent.ts`, add the import:

```typescript
import type { ManagedShellService } from '../managedShell.ts'
```

- [ ] **Step 2: Add ManagedShellService parameter to AuraAgent constructor**

Find the `AuraAgent` class constructor. It currently takes `AuraQueryService`, `projectPath`, `ollamaConfig`, and `contextWindow`. Add `managedShellService` as a parameter. Store it as a class property:

```typescript
class AuraAgent {
  private qs: AuraQueryService
  private projectPath: string
  private ollamaConfig: { model: string; url: string }
  private contextWindow: number
  private managedShells: ManagedShellService | null

  constructor(qs: AuraQueryService, projectPath: string, ollamaConfig: { model: string; url: string }, contextWindow: number, managedShells?: ManagedShellService) {
    this.qs = qs
    this.projectPath = projectPath
    this.ollamaConfig = ollamaConfig
    this.contextWindow = contextWindow
    this.managedShells = managedShells || null
  }
```

- [ ] **Step 3: Add shell tools to `defineAgentTools`**

The `defineAgentTools` function currently takes `(qs, projectPath)`. Add `managedShells?: ManagedShellService` and `projectId?: string` parameters. After the existing `git` tool definition (search for `name: 'git'`), add four new tools:

```typescript
// ── Managed Shell Tools ──────────────────────────────────────────────────

{
  name: 'shell_spawn',
  description: 'Spawn a background shell for long-running commands (dev servers, builds, test suites, watchers). The shell runs independently — you can check on it later with shell_read. Use descriptive names like "dev-server", "run-tests", "install-deps". IMPORTANT: Before starting any dependent task (e.g., running tests after a build), use shell_read to confirm the shell completed successfully. Do NOT use this for quick commands — use execute for those.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Descriptive name for this shell, e.g. "dev-server", "build-project", "install-deps"' },
      command: { type: 'string', description: 'The shell command to run in the background' },
      cwd: { type: 'string', description: 'Working directory (defaults to project root)' },
    },
    required: ['name', 'command'],
  },
  execute: async (args) => {
    if (!managedShells || !projectId) {
      return { error: 'Managed shells are not available for this project' }
    }
    try {
      const shell = await managedShells.spawn(projectId, args.name as string, args.command as string, args.cwd as string | undefined)
      return { shellId: shell.id, name: shell.name, status: shell.status, message: `Background shell "${shell.name}" spawned. Use shell_read to check progress.` }
    } catch (err: unknown) {
      return { error: `Failed to spawn shell: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
},

{
  name: 'shell_read',
  description: 'Read the output and status of a background shell. Returns recent output (last 1MB), status, and exit code. If output was truncated by the ring buffer, includes the full log file path. IMPORTANT: Always check shell_read before starting dependent work — do not assume a build or install is done just because you spawned it.',
  parameters: {
    type: 'object',
    properties: {
      shellId: { type: 'string', description: 'The shell ID returned by shell_spawn' },
      tailLines: { type: 'number', description: 'Number of lines to return from the end of output (default: all)' },
    },
    required: ['shellId'],
  },
  execute: async (args) => {
    if (!managedShells) {
      return { error: 'Managed shells are not available' }
    }
    const result = managedShells.readOutput(args.shellId as string, args.tailLines as number | undefined)
    if (!result) {
      return { error: `Shell "${args.shellId}" not found. Use shell_list to see available shells.` }
    }
    return result
  },
},

{
  name: 'shell_terminate',
  description: 'Terminate a running background shell. Use this to stop dev servers, long-running processes, or shells you no longer need.',
  parameters: {
    type: 'object',
    properties: {
      shellId: { type: 'string', description: 'The shell ID to terminate' },
    },
    required: ['shellId'],
  },
  execute: async (args) => {
    if (!managedShells) {
      return { error: 'Managed shells are not available' }
    }
    const success = managedShells.terminate(args.shellId as string)
    return success
      ? { success: true, message: `Shell "${args.shellId}" terminated` }
      : { error: `Shell "${args.shellId}" not found or already exited` }
  },
},

{
  name: 'shell_list',
  description: 'List all managed background shells and their statuses. Use this to check which shells are running, completed, or failed before deciding what to do next.',
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: async () => {
    if (!managedShells) {
      return { error: 'Managed shells are not available' }
    }
    const shells = managedShells.listShells(projectId)
    return { shells }
  },
},
```

- [ ] **Step 4: Update `defineAgentTools` function signature**

Change the function signature from:

```typescript
function defineAgentTools(qs: AuraQueryService, projectPath: string): AgentTool[] {
```

to:

```typescript
function defineAgentTools(qs: AuraQueryService, projectPath: string, managedShells?: ManagedShellService, projectId?: string): AgentTool[] {
```

- [ ] **Step 5: Update all call sites of `defineAgentTools`**

Find the two places `defineAgentTools` is called (around lines 1475 and 1984) and update them to pass `managedShells` and `projectId`. The `AuraAgent` class already has `this.managedShells` and the agent receives `projectId` as part of the project context. Check the `ask` method or `run` method to find where `projectId` is available.

Update calls from:
```typescript
const tools = defineAgentTools(this.qs, this.projectPath)
```
to:
```typescript
const tools = defineAgentTools(this.qs, this.projectPath, this.managedShells ?? undefined, this.projectId)
```

Note: The `projectId` needs to be passed through the agent. Check the `ask` method signature — it should receive `projectId` as a parameter or from context. If not already available, add it as a parameter to the `ask` method and store it on the agent instance.

- [ ] **Step 6: Update the system prompt**

In the `buildSystemPrompt` function, add a new section after "## Running Commands":

```typescript
## Background Shell Management

You have tools to manage background shells: shell_spawn, shell_read, shell_terminate, shell_list.

When to use background shells vs inline execute:
- Use `execute` for quick commands that complete in seconds (git status, ls, cat, quick checks)
- Use `shell_spawn` for long-running commands (npm run dev, npm run build, test suites, dev servers, watchers)

DEPENDENCY RULE: Before starting any task that depends on a background shell's completion, you MUST use `shell_read` to confirm the shell has completed successfully. For example:
- After spawning "install-deps", do NOT start "build-project" until shell_read confirms install-deps exited with code 0
- After spawning "build-project", do NOT start "run-tests" until shell_read confirms the build succeeded

Naming: Give each shell a descriptive name that reflects its purpose (e.g., "install-deps", "dev-server", "run-tests", "build-project").

When a shell completes, you will be informed via the shell_exited event. Check its output before proceeding with dependent work.
```

- [ ] **Step 7: Verify compilation**

Run: `cd "C:/Users/abhir/Desktop/IMPORTANT/claude" && npx tsc --noEmit --project tsconfig.server.json 2>&1 | head -30`

Expected: No new errors related to agent.ts. Fix any type issues.

- [ ] **Step 8: Commit**

```bash
cd "C:/Users/abhir/Desktop/IMPORTANT/claude"
git add server/services/aura/agent.ts
git commit -m "feat: add shell_spawn, shell_read, shell_terminate, shell_list agent tools

Four new tools give the AI agent explicit control over background
shells. Includes dependency rule in system prompt and ManagedShellService
parameter threading through the agent."
```

---

### Task 4: REST Routes + Server Wiring

**Files:**
- Create: `server/routes/managedShell.ts`
- Modify: `server/index.ts`
- Modify: `server/routes/aura.ts`

- [ ] **Step 1: Create managed shell REST routes**

```typescript
// server/routes/managedShell.ts
import { Router, type Request, type Response } from 'express'
import type { ManagedShellService } from '../services/managedShell.ts'

export function createManagedShellRouter(managedShellService: ManagedShellService): Router {
  const router = Router()

  // List all managed shells for a project
  router.get('/:projectId', (req: Request, res: Response) => {
    const { projectId } = req.params
    const shells = managedShellService.listShells(projectId)
    res.json({ shells })
  })

  // Get shell output
  router.get('/:projectId/:shellId/output', (req: Request, res: Response) => {
    const { shellId } = req.params
    const tailLines = req.query.tailLines ? parseInt(req.query.tailLines as string, 10) : undefined
    const result = managedShellService.readOutput(shellId, tailLines)
    if (!result) {
      res.status(404).json({ error: 'Shell not found' })
      return
    }
    res.json(result)
  })

  // Terminate a shell
  router.post('/:projectId/:shellId/terminate', (req: Request, res: Response) => {
    const { shellId } = req.params
    const success = managedShellService.terminate(shellId)
    res.json({ success })
  })

  // Dismiss (remove) a completed/failed shell
  router.delete('/:projectId/:shellId', (req: Request, res: Response) => {
    const { shellId } = req.params
    const success = managedShellService.dismissShell(shellId)
    res.json({ success })
  })

  return router
}
```

- [ ] **Step 2: Wire up in server/index.ts**

Add the import at the top of `server/index.ts`:

```typescript
import { ManagedShellService } from './services/managedShell.ts'
import { createManagedShellRouter } from './routes/managedShell.ts'
```

After the existing service instantiations (around line 84, after `const terminalService = new TerminalService(projectService)`), add:

```typescript
const managedShellService = new ManagedShellService(projectService)
```

After the route registrations (around line 99, after `app.use('/api/aura', ...)`), add:

```typescript
app.use('/api/managed-shells', createManagedShellRouter(managedShellService))
```

- [ ] **Step 3: Pass ManagedShellService to aura router**

In `server/routes/aura.ts`, update the `createAuraRouter` function signature to accept `managedShellService`. Add the import:

```typescript
import type { ManagedShellService } from '../services/managedShell.ts'
```

Add `managedShellService: ManagedShellService` to the function parameters.

Then, wherever `new AuraAgent(...)` is instantiated in the aura routes (search for `new AuraAgent`), add `managedShellService` as the 5th argument. Also pass `projectId` which should be available in the request context.

- [ ] **Step 4: Update server/index.ts to pass managedShellService to aura router**

Find the line where `createAuraRouter` is called and add `managedShellService`:

```typescript
app.use('/api/aura', createAuraRouter(projectService, auraIndexers, auraQueries, auraWatcherManager, groupService, DATA_DIR, store, managedShellService))
```

- [ ] **Step 5: Connect ManagedShellService events to SSE**

In `server/routes/aura.ts`, find where the SSE streaming handler is set up for the `/ask/:projectId` route. After creating the `SSEEventSink`, subscribe to managed shell events and forward them:

```typescript
// Forward managed shell events to the SSE stream
const onShellEvent = (event: import('../services/managedShell.ts').ShellEvent) => {
  if (event.type === 'shell_spawned') {
    eventSink.emit(AgentEventType.ShellSpawned, { shellId: event.shellId, name: event.name, command: event.command })
  } else if (event.type === 'shell_output') {
    eventSink.emit(AgentEventType.ShellOutput, { shellId: event.shellId, data: event.data })
  } else if (event.type === 'shell_exited') {
    eventSink.emit(AgentEventType.ShellExited, { shellId: event.shellId, exitCode: event.exitCode, name: event.name })
  } else if (event.type === 'shell_terminated') {
    eventSink.emit(AgentEventType.ShellTerminated, { shellId: event.shellId, name: event.name })
  }
}
managedShellService.on('event', onShellEvent)

// Clean up on stream close
req.on('close', () => {
  managedShellService.off('event', onShellEvent)
})
```

- [ ] **Step 6: Verify compilation**

Run: `cd "C:/Users/abhir/Desktop/IMPORTANT/claude" && npx tsc --noEmit --project tsconfig.server.json 2>&1 | head -30`

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/abhir/Desktop/IMPORTANT/claude"
git add server/routes/managedShell.ts server/index.ts server/routes/aura.ts
git commit -m "feat: add managed shell REST routes and wire up SSE events

REST API for listing, reading, terminating, and dismissing managed shells.
SSE forwarding sends shell_spawned/shell_output/shell_exited/shell_terminated
events to the frontend during AI agent sessions."
```

---

### Task 5: Frontend Types and useManagedShells Hook

**Files:**
- Create: `src/hooks/useManagedShells.ts`

- [ ] **Step 1: Create the useManagedShells hook**

```typescript
// src/hooks/useManagedShells.ts
import { useState, useEffect, useCallback, useRef } from 'react'

export type ManagedShellStatus = 'running' | 'completed' | 'failed' | 'killed'

export interface ManagedShellInfo {
  id: string
  name: string
  command: string
  status: ManagedShellStatus
  exitCode: number | null
  createdAt: number
}

export interface ManagedShellState extends ManagedShellInfo {
  output: string
}

export function useManagedShells(projectId: string | null) {
  const [shells, setShells] = useState<Map<string, ManagedShellState>>(new Map())
  const [viewingShell, setViewingShell] = useState<string | null>(null)
  const shellsRef = useRef(shells)
  shellsRef.current = shells

  // Fetch current shell list from REST API
  const fetchShells = useCallback(async () => {
    if (!projectId) return
    try {
      const res = await fetch(`/api/managed-shells/${projectId}`)
      if (!res.ok) return
      const data = await res.json()
      const list: ManagedShellInfo[] = data.shells || []
      setShells(prev => {
        const next = new Map(prev)
        for (const s of list) {
          const existing = next.get(s.id)
          if (existing) {
            // Update status/exitCode if changed
            if (existing.status !== s.status || existing.exitCode !== s.exitCode) {
              next.set(s.id, { ...existing, status: s.status, exitCode: s.exitCode })
            }
          } else {
            next.set(s.id, { ...s, output: '' })
          }
        }
        // Remove shells no longer on server
        const serverIds = new Set(list.map(s => s.id))
        for (const id of next.keys()) {
          if (!serverIds.has(id)) next.delete(id)
        }
        return next
      })
    } catch {
      // Fetch failed silently
    }
  }, [projectId])

  // Fetch initial state
  useEffect(() => {
    fetchShells()
  }, [fetchShells])

  // Handle SSE shell events (called from useAura's SSE parser)
  const handleShellEvent = useCallback((eventType: string, data: Record<string, unknown>) => {
    if (eventType === 'shell_spawned') {
      setShells(prev => {
        const next = new Map(prev)
        next.set(data.shellId as string, {
          id: data.shellId as string,
          name: data.name as string,
          command: data.command as string,
          status: 'running',
          exitCode: null,
          createdAt: Date.now(),
          output: '',
        })
        return next
      })
    } else if (eventType === 'shell_output') {
      setShells(prev => {
        const next = new Map(prev)
        const shell = next.get(data.shellId as string)
        if (shell) {
          // Keep last 1MB of output in memory
          let output = shell.output + (data.data as string)
          if (output.length > 1024 * 1024) {
            output = output.slice(output.length - 1024 * 1024)
          }
          next.set(data.shellId as string, { ...shell, output })
        }
        return next
      })
    } else if (eventType === 'shell_exited') {
      setShells(prev => {
        const next = new Map(prev)
        const shell = next.get(data.shellId as string)
        if (shell) {
          const status: ManagedShellStatus = data.exitCode === 0 ? 'completed' : 'failed'
          next.set(data.shellId as string, { ...shell, status, exitCode: data.exitCode as number })
        }
        return next
      })
    } else if (eventType === 'shell_terminated') {
      setShells(prev => {
        const next = new Map(prev)
        const shell = next.get(data.shellId as string)
        if (shell) {
          next.set(data.shellId as string, { ...shell, status: 'killed', exitCode: -1 })
        }
        return next
      })
    }
  }, [])

  // Dismiss a completed/failed shell
  const dismissShell = useCallback(async (shellId: string) => {
    if (!projectId) return
    try {
      await fetch(`/api/managed-shells/${projectId}/${shellId}`, { method: 'DELETE' })
      setShells(prev => {
        const next = new Map(prev)
        next.delete(shellId)
        return next
      })
      if (viewingShell === shellId) setViewingShell(null)
    } catch {
      // Dismiss failed
    }
  }, [projectId, viewingShell])

  // Terminate a running shell
  const terminateShell = useCallback(async (shellId: string) => {
    if (!projectId) return
    try {
      await fetch(`/api/managed-shells/${projectId}/${shellId}/terminate`, { method: 'POST' })
    } catch {
      // Terminate failed
    }
  }, [projectId])

  const activeShells = [...shells.values()].filter(s => s.status === 'running')
  const allShells = [...shells.values()]

  return {
    shells,
    activeShells,
    allShells,
    viewingShell,
    setViewingShell,
    handleShellEvent,
    dismissShell,
    terminateShell,
    fetchShells,
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd "C:/Users/abhir/Desktop/IMPORTANT/claude"
git add src/hooks/useManagedShells.ts
git commit -m "feat: add useManagedShells hook for frontend shell state management

React hook that manages shell state, handles SSE events for real-time
updates, and provides dismiss/terminate actions."
```

---

### Task 6: SSE Parsing in useAura for Shell Events

**Files:**
- Modify: `src/hooks/useAura.ts`

- [ ] **Step 1: Add shell event types to AuraChatMessage**

In the `AuraChatMessage` interface (around line 425-433), add a `shells` field:

```typescript
export interface AuraShellEvent {
  shellId: string
  name: string
  command: string
  status: 'running' | 'completed' | 'failed' | 'killed'
  exitCode: number | null
}

export interface AuraChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: AuraToolCall[]
  subAgents?: AuraSubAgentInfo[]
  todos?: AuraTodoItem[]
  shells?: AuraShellEvent[]      // NEW
  timestamp: number
}
```

- [ ] **Step 2: Handle shell events in the SSE parser**

In the `ask` function's SSE parsing loop (around line 1160-1230), add handlers for the new shell event types. Inside the `setChatMessages` callback, after the `approval_request` handler:

```typescript
} else if (eventType === 'shell_spawned') {
  msg.shells = [...(msg.shells || []), {
    shellId: data.shellId,
    name: data.name,
    command: data.command,
    status: 'running' as const,
    exitCode: null,
  }]
  // Also forward to managed shells hook
  onShellEvent?.('shell_spawned', data)
} else if (eventType === 'shell_exited') {
  msg.shells = (msg.shells || []).map((s: AuraShellEvent) =>
    s.shellId === data.shellId
      ? { ...s, status: data.exitCode === 0 ? 'completed' as const : 'failed' as const, exitCode: data.exitCode as number }
      : s
  )
  onShellEvent?.('shell_exited', data)
} else if (eventType === 'shell_terminated') {
  msg.shells = (msg.shells || []).map((s: AuraShellEvent) =>
    s.shellId === data.shellId
      ? { ...s, status: 'killed' as const, exitCode: -1 }
      : s
  )
  onShellEvent?.('shell_terminated', data)
} else if (eventType === 'shell_output') {
  onShellEvent?.('shell_output', data)
}
```

- [ ] **Step 3: Add onShellEvent parameter to the ask function**

The `ask` function in `useAura` needs to accept an `onShellEvent` callback so it can forward shell events to the `useManagedShells` hook. Add it as a parameter:

Find the `ask` function definition and add `onShellEvent?: (eventType: string, data: Record<string, unknown>) => void` as a parameter. This will be passed from the component level.

- [ ] **Step 4: Verify compilation**

Run: `cd "C:/Users/abhir/Desktop/IMPORTANT/claude" && npx tsc --noEmit 2>&1 | head -30`

Expected: May have type errors from the new `shells` field not being used yet in components — those will be addressed in later tasks.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/abhir/Desktop/IMPORTANT/claude"
git add src/hooks/useAura.ts
git commit -m "feat: parse shell SSE events in useAura and add AuraShellEvent type

Shell spawned/exited/terminated events are stored in AuraChatMessage
and forwarded to the useManagedShells hook for real-time UI updates."
```

---

### Task 7: ShellBlock Component (Inline Chat)

**Files:**
- Create: `src/components/aura/ShellBlock.tsx`
- Create: `src/styles/managed-shell.css` (initial styles)

- [ ] **Step 1: Create ShellBlock component**

```tsx
// src/components/aura/ShellBlock.tsx
import type { AuraShellEvent } from '../../hooks/useAura'

interface ShellBlockProps {
  shells: AuraShellEvent[]
  onViewShell?: (shellId: string) => void
}

function ShellStatusIcon({ status }: { status: AuraShellEvent['status'] }) {
  if (status === 'running') {
    return <span className="shell-block__icon shell-block__icon--running">⏳</span>
  }
  if (status === 'completed') {
    return <span className="shell-block__icon shell-block__icon--completed">✓</span>
  }
  if (status === 'failed') {
    return <span className="shell-block__icon shell-block__icon--failed">✗</span>
  }
  return <span className="shell-block__icon shell-block__icon--killed">⊘</span>
}

export function ShellBlock({ shells, onViewShell }: ShellBlockProps) {
  if (!shells || shells.length === 0) return null

  return (
    <div className="shell-block__list">
      {shells.map((shell) => (
        <div
          key={shell.shellId}
          className={`shell-block shell-block--${shell.status}`}
          onClick={() => onViewShell?.(shell.shellId)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') onViewShell?.(shell.shellId) }}
        >
          <ShellStatusIcon status={shell.status} />
          <span className="shell-block__name">{shell.name}</span>
          <span className="shell-block__command">{shell.command}</span>
          {shell.status === 'running' && <span className="shell-block__spinner" />}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Add initial CSS for ShellBlock**

In `src/styles/managed-shell.css`:

```css
/* Shell Blocks — inline chat blocks for background shells */
.shell-block__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 4px 0;
}

.shell-block {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}

.shell-block:hover {
  filter: brightness(1.1);
}

.shell-block--running {
  background: rgba(59, 130, 246, 0.15);
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.shell-block--completed {
  background: rgba(34, 197, 94, 0.12);
  border: 1px solid rgba(34, 197, 94, 0.25);
}

.shell-block--failed {
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.25);
}

.shell-block--killed {
  background: rgba(156, 163, 175, 0.12);
  border: 1px solid rgba(156, 163, 175, 0.25);
}

.shell-block__icon {
  font-size: 12px;
}

.shell-block__icon--running {
  color: #3b82f6;
}

.shell-block__icon--completed {
  color: #22c55e;
}

.shell-block__icon--failed {
  color: #ef4444;
}

.shell-block__icon--killed {
  color: #9ca3af;
}

.shell-block__name {
  font-weight: 600;
  min-width: 80px;
}

.shell-block__command {
  font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
  font-size: 12px;
  opacity: 0.8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.shell-block__spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(59, 130, 246, 0.3);
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: shell-spin 0.8s linear infinite;
}

@keyframes shell-spin {
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/abhir/Desktop/IMPORTANT/claude"
git add src/components/aura/ShellBlock.tsx src/styles/managed-shell.css
git commit -m "feat: add ShellBlock component for inline chat shell indicators

Shows spawned shell name, command, and status (running/completed/failed)
as clickable blocks in the chat stream."
```

---

### Task 8: AuraChat Integration

**Files:**
- Modify: `src/components/aura/AuraChat.tsx`

- [ ] **Step 1: Import ShellBlock and add to ChatMessage**

Add the import at the top of `AuraChat.tsx`:

```typescript
import { ShellBlock } from './ShellBlock'
```

Add `shells` and `onViewShell` to the `AuraChatProps` interface:

```typescript
interface AuraChatProps {
  messages: AuraChatMessage[]
  isStreaming: boolean
  error: string | null
  onAsk: (prompt: string) => void
  onClearError: () => void
  pendingApproval: AuraApprovalRequest | null
  onRespondToApproval: (approvalId: string, approved: boolean, feedback?: string) => void
  onViewShell?: (shellId: string) => void   // NEW
}
```

In the `ChatMessage` function component, add ShellBlock rendering after the `TodoListSection`:

```tsx
{!isUser && msg.shells && msg.shells.length > 0 && (
  <ShellBlock shells={msg.shells} onViewShell={onViewShell} />
)}
```

Pass `onViewShell` through the `ChatMessage` component — add it to the props:

```typescript
function ChatMessage({ msg, onViewShell }: { msg: AuraChatMessage; onViewShell?: (shellId: string) => void }) {
```

Update the `ChatMessage` rendering in `AuraChat` to pass the prop:

```tsx
{messages.map(msg => (
  <ChatMessage key={msg.id} msg={msg} onViewShell={onViewShell} />
))}
```

- [ ] **Step 2: Commit**

```bash
cd "C:/Users/abhir/Desktop/IMPORTANT/claude"
git add src/components/aura/AuraChat.tsx
git commit -m "feat: render ShellBlock in AuraChat for background shell events"
```

---

### Task 9: ManagedShellBadge (Header)

**Files:**
- Create: `src/components/aura/ManagedShellBadge.tsx`

- [ ] **Step 1: Create the badge component**

```tsx
// src/components/aura/ManagedShellBadge.tsx
import { useState, useRef, useEffect } from 'react'
import type { ManagedShellState } from '../../hooks/useManagedShells'

interface ManagedShellBadgeProps {
  activeShells: ManagedShellState[]
  allShells: ManagedShellState[]
  onViewShell: (shellId: string) => void
  onTerminateShell: (shellId: string) => void
  onDismissShell: (shellId: string) => void
}

function ShellStatusIcon({ status }: { status: ManagedShellState['status'] }) {
  if (status === 'running') return <span className="ms-badge__status ms-badge__status--running">●</span>
  if (status === 'completed') return <span className="ms-badge__status ms-badge__status--completed">✓</span>
  if (status === 'failed') return <span className="ms-badge__status ms-badge__status--failed">✗</span>
  return <span className="ms-badge__status ms-badge__status--killed">⊘</span>
}

export function ManagedShellBadge({ activeShells, allShells, onViewShell, onTerminateShell, onDismissShell }: ManagedShellBadgeProps) {
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  if (allShells.length === 0) return null

  return (
    <div className="ms-badge" ref={dropdownRef}>
      <button
        className={`ms-badge__trigger ${activeShells.length > 0 ? 'ms-badge__trigger--active' : ''}`}
        onClick={() => setOpen(!open)}
        title={`${activeShells.length} active shell${activeShells.length !== 1 ? 's' : ''}`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
        {activeShells.length > 0 && (
          <span className="ms-badge__count">{activeShells.length}</span>
        )}
      </button>
      {open && (
        <div className="ms-badge__dropdown">
          <div className="ms-badge__dropdown-header">
            Background Shells
          </div>
          {allShells.length === 0 ? (
            <div className="ms-badge__empty">No shells</div>
          ) : (
            allShells.map(shell => (
              <div key={shell.id} className={`ms-badge__shell-item ms-badge__shell-item--${shell.status}`}>
                <ShellStatusIcon status={shell.status} />
                <div className="ms-badge__shell-info" onClick={() => { onViewShell(shell.id); setOpen(false) }}>
                  <span className="ms-badge__shell-name">{shell.name}</span>
                  <span className="ms-badge__shell-command">{shell.command}</span>
                </div>
                <div className="ms-badge__shell-actions">
                  {shell.status === 'running' && (
                    <button
                      className="ms-badge__shell-btn ms-badge__shell-btn--terminate"
                      onClick={(e) => { e.stopPropagation(); onTerminateShell(shell.id) }}
                      title="Terminate"
                    >
                      ■
                    </button>
                  )}
                  {shell.status !== 'running' && (
                    <button
                      className="ms-badge__shell-btn ms-badge__shell-btn--dismiss"
                      onClick={(e) => { e.stopPropagation(); onDismissShell(shell.id) }}
                      title="Dismiss"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add badge styles to managed-shell.css**

Append to `src/styles/managed-shell.css`:

```css
/* Managed Shell Badge — header dropdown */
.ms-badge {
  position: relative;
}

.ms-badge__trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--assistant-border, rgba(255,255,255,0.1));
  background: transparent;
  color: var(--assistant-fg, #e0e0e0);
  cursor: pointer;
  font-size: 12px;
  transition: background 0.15s;
}

.ms-badge__trigger:hover {
  background: rgba(255,255,255,0.05);
}

.ms-badge__trigger--active {
  border-color: rgba(59, 130, 246, 0.4);
  background: rgba(59, 130, 246, 0.08);
}

.ms-badge__count {
  background: #3b82f6;
  color: white;
  font-size: 10px;
  font-weight: 700;
  border-radius: 10px;
  min-width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}

.ms-badge__dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 280px;
  max-width: 360px;
  background: var(--assistant-bg, #1a1a2e);
  border: 1px solid var(--assistant-border, rgba(255,255,255,0.1));
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  z-index: 100;
  overflow: hidden;
}

.ms-badge__dropdown-header {
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--assistant-muted, #888);
  border-bottom: 1px solid var(--assistant-border, rgba(255,255,255,0.1));
}

.ms-badge__empty {
  padding: 12px;
  text-align: center;
  color: var(--assistant-muted, #888);
  font-size: 13px;
}

.ms-badge__shell-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--assistant-border, rgba(255,255,255,0.05));
  transition: background 0.1s;
}

.ms-badge__shell-item:hover {
  background: rgba(255,255,255,0.03);
}

.ms-badge__shell-item:last-child {
  border-bottom: none;
}

.ms-badge__status {
  font-size: 12px;
}

.ms-badge__status--running {
  color: #3b82f6;
  animation: ms-pulse 1.5s ease-in-out infinite;
}

.ms-badge__status--completed {
  color: #22c55e;
}

.ms-badge__status--failed {
  color: #ef4444;
}

.ms-badge__status--killed {
  color: #9ca3af;
}

@keyframes ms-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.ms-badge__shell-info {
  flex: 1;
  cursor: pointer;
  min-width: 0;
}

.ms-badge__shell-name {
  display: block;
  font-weight: 600;
  font-size: 13px;
}

.ms-badge__shell-command {
  display: block;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 11px;
  color: var(--assistant-muted, #888);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ms-badge__shell-actions {
  display: flex;
  gap: 4px;
}

.ms-badge__shell-btn {
  background: none;
  border: 1px solid var(--assistant-border, rgba(255,255,255,0.15));
  border-radius: 4px;
  color: var(--assistant-muted, #888);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
  transition: all 0.15s;
}

.ms-badge__shell-btn:hover {
  background: rgba(255,255,255,0.1);
  color: var(--assistant-fg, #e0e0e0);
}

.ms-badge__shell-btn--terminate:hover {
  border-color: #ef4444;
  color: #ef4444;
}

.ms-badge__shell-btn--dismiss:hover {
  border-color: #9ca3af;
}
```

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/abhir/Desktop/IMPORTANT/claude"
git add src/components/aura/ManagedShellBadge.tsx src/styles/managed-shell.css
git commit -m "feat: add ManagedShellBadge for header shell count and dropdown

Badge shows active shell count in the header. Dropdown lists all shells
with status, name, command. Supports terminate and dismiss actions."
```

---

### Task 10: ManagedTerminalPanel (Full Terminal View)

**Files:**
- Create: `src/components/aura/ManagedTerminalPanel.tsx`

- [ ] **Step 1: Create the read-only terminal view component**

```tsx
// src/components/aura/ManagedTerminalPanel.tsx
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { ManagedShellState } from '../../hooks/useManagedShells'
import '@xterm/xterm/css/xterm.css'

interface ManagedTerminalPanelProps {
  shell: ManagedShellState
  onDismiss: (shellId: string) => void
  onTerminate: (shellId: string) => void
  isLight: boolean
}

export function ManagedTerminalPanel({ shell, onDismiss, onTerminate, isLight }: ManagedTerminalPanelProps) {
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!termRef.current || xtermRef.current) return

    const term = new Terminal({
      theme: isLight
        ? { background: '#fafafa', foreground: '#383a42', cursor: '#526fff', selectionBackground: '#add6ff' }
        : { background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc', selectionBackground: '#45475a' },
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
      fontSize: 13,
      cursorBlink: false,
      disableStdin: true, // Read-only
      convertEol: true,
      scrollback: 10000,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)

    term.open(termRef.current)
    fitAddon.fit()

    xtermRef.current = term
    fitRef.current = fitAddon

    // Write existing output
    if (shell.output) {
      term.write(shell.output)
    }

    return () => {
      term.dispose()
      xtermRef.current = null
      fitRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Write new output as it comes in
  const lastOutputLengthRef = useRef(shell.output.length)
  useEffect(() => {
    const term = xtermRef.current
    if (!term) return

    const newOutput = shell.output.slice(lastOutputLengthRef.current)
    if (newOutput) {
      term.write(newOutput)
    }
    lastOutputLengthRef.current = shell.output.length
  }, [shell.output])

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      fitRef.current?.fit()
    }
    window.addEventListener('resize', handleResize)
    handleResize()
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const statusLabel = shell.status === 'running' ? 'Running'
    : shell.status === 'completed' ? `Completed (exit ${shell.exitCode})`
    : shell.status === 'failed' ? `Failed (exit ${shell.exitCode})`
    : 'Terminated'

  const statusClass = shell.status === 'running' ? 'mtp__status--running'
    : shell.status === 'completed' ? 'mtp__status--completed'
    : shell.status === 'failed' ? 'mtp__status--failed'
    : 'mtp__status--killed'

  return (
    <div className="mtp">
      <div className="mtp__header">
        <div className="mtp__header-left">
          <span className="mtp__name">{shell.name}</span>
          <span className={`mtp__status ${statusClass}`}>{statusLabel}</span>
        </div>
        <div className="mtp__header-right">
          {shell.status === 'running' && (
            <button className="mtp__btn mtp__btn--terminate" onClick={() => onTerminate(shell.id)}>
              Terminate
            </button>
          )}
          {shell.status !== 'running' && (
            <button className="mtp__btn mtp__btn--dismiss" onClick={() => onDismiss(shell.id)}>
              Dismiss
            </button>
          )}
        </div>
      </div>
      <div className="mtp__command">{shell.command}</div>
      <div className="mtp__terminal" ref={termRef} />
    </div>
  )
}
```

- [ ] **Step 2: Add terminal panel styles to managed-shell.css**

Append to `src/styles/managed-shell.css`:

```css
/* Managed Terminal Panel — full terminal view */
.mtp {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--assistant-border, rgba(255,255,255,0.1));
  border-radius: 8px;
  overflow: hidden;
  background: #1e1e2e;
  margin: 8px 0;
}

.mtp__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: rgba(255,255,255,0.03);
  border-bottom: 1px solid var(--assistant-border, rgba(255,255,255,0.1));
}

.mtp__header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mtp__name {
  font-weight: 600;
  font-size: 13px;
  color: var(--assistant-fg, #e0e0e0);
}

.mtp__status {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
}

.mtp__status--running {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
}

.mtp__status--completed {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.mtp__status--failed {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.mtp__status--killed {
  background: rgba(156, 163, 175, 0.15);
  color: #9ca3af;
}

.mtp__header-right {
  display: flex;
  gap: 6px;
}

.mtp__btn {
  padding: 3px 10px;
  border-radius: 4px;
  border: 1px solid var(--assistant-border, rgba(255,255,255,0.15));
  background: transparent;
  color: var(--assistant-muted, #888);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.mtp__btn:hover {
  background: rgba(255,255,255,0.08);
}

.mtp__btn--terminate:hover {
  border-color: #ef4444;
  color: #ef4444;
}

.mtp__btn--dismiss:hover {
  border-color: #9ca3af;
}

.mtp__command {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 11px;
  padding: 4px 12px;
  background: rgba(0,0,0,0.2);
  color: var(--assistant-muted, #888);
  border-bottom: 1px solid var(--assistant-border, rgba(255,255,255,0.05));
}

.mtp__terminal {
  height: 300px;
  padding: 4px;
}
```

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/abhir/Desktop/IMPORTANT/claude"
git add src/components/aura/ManagedTerminalPanel.tsx src/styles/managed-shell.css
git commit -m "feat: add ManagedTerminalPanel for read-only terminal view

xterm.js-based read-only terminal showing shell output in real-time.
Header shows shell name, status, and terminate/dismiss actions."
```

---

### Task 11: AssistantPage Integration

**Files:**
- Modify: `src/pages/builder/AssistantPage.tsx`
- Modify: `src/pages/ProjectModeBuilderPage.tsx` (to pass managedShells state down)

- [ ] **Step 1: Update AssistantPage to add badge and terminal panel**

Add imports at the top of `AssistantPage.tsx`:

```typescript
import { ManagedShellBadge } from '../../components/aura/ManagedShellBadge'
import { ManagedTerminalPanel } from '../../components/aura/ManagedTerminalPanel'
import { useManagedShells } from '../../hooks/useManagedShells'
import '../../styles/managed-shell.css'
```

Update the props to accept the `onShellEvent` callback from the parent and add `useManagedShells`:

```typescript
interface AssistantPageProps {
  projectId: string
  projectName: string
  workspacePath: string
  conversationId: string | null
  aura: ReturnType<typeof useAura>
}
```

In the component function, add the managed shells hook:

```typescript
const managedShells = useManagedShells(projectId)
```

In the header `assistant-page__header` div, add the badge after the context bar:

```tsx
<ManagedShellBadge
  activeShells={managedShells.activeShells}
  allShells={managedShells.allShells}
  onViewShell={managedShells.setViewingShell}
  onTerminateShell={managedShells.terminateShell}
  onDismissShell={managedShells.dismissShell}
/>
```

Add the terminal panel view after the `<AuraChat>` component, before the confirm overlay:

```tsx
{managedShells.viewingShell && (() => {
  const shell = managedShells.shells.get(managedShells.viewingShell)
  if (!shell) return null
  return (
    <ManagedTerminalPanel
      shell={shell}
      onDismiss={managedShells.dismissShell}
      onTerminate={managedShells.terminateShell}
      isLight={theme === 'light'}
    />
  )
})()}
```

- [ ] **Step 2: Pass shell events from useAura to useManagedShells**

The `useAura.ask()` function needs to forward shell events. Update the `ask` call in `AssistantPage` (or wherever `aura.ask()` is called) to pass the `managedShells.handleShellEvent` callback:

```typescript
const handleAsk = useCallback((prompt: string) => {
  aura.ask(prompt, managedShells.handleShellEvent)
}, [aura, managedShells.handleShellEvent])
```

Note: This requires updating the `ask` function signature in `useAura.ts` to accept an optional `onShellEvent` parameter. This was done in Task 6 Step 3. Make sure the parameter flows through correctly.

Update the `AuraChat` component usage in `AssistantPage`:

```tsx
<AuraChat
  messages={aura.chatMessages}
  isStreaming={aura.isStreaming}
  error={aura.chatError}
  onAsk={handleAsk}
  onClearError={aura.clearChatError}
  pendingApproval={aura.pendingApproval}
  onRespondToApproval={aura.respondToApproval}
  onViewShell={managedShells.setViewingShell}
/>
```

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/abhir/Desktop/IMPORTANT/claude"
git add src/pages/builder/AssistantPage.tsx
git commit -m "feat: integrate managed shell badge and terminal panel into AssistantPage

Badge in header shows active shell count. Terminal panel opens when
a shell is selected. Shell events flow from useAura to useManagedShells."
```

---

### Task 12: Full Integration Test

**Files:** None (testing only)

- [ ] **Step 1: Start the dev server and verify it compiles**

Run: `cd "C:/Users/abhir/Desktop/IMPORTANT/claude" && npm run dev`

Expected: Both Vite and the Express server start without errors.

- [ ] **Step 2: Test the managed shell flow end-to-end**

1. Open the AURA builder for a project
2. Ask the AI to run a long-running command (e.g., "Start the dev server in the background")
3. Verify: A ShellBlock appears in the chat showing the shell name and "running" status
4. Verify: The header badge shows the active shell count
5. Click the badge and verify the dropdown shows the shell
6. Click the shell name and verify the terminal panel opens with output
7. Wait for the command to complete and verify the status updates
8. Test the dismiss button on a completed shell

- [ ] **Step 3: Verify the AI can use shell tools**

Ask the AI: "List all running background shells" and verify it calls `shell_list` and shows the results.

Ask the AI: "Spawn a background shell to run the build" and verify it calls `shell_spawn` with a descriptive name.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
cd "C:/Users/abhir/Desktop/IMPORTANT/claude"
git add -A
git commit -m "fix: integration fixes for managed shell system"
```