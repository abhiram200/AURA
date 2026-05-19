# Managed Shell System — Design Spec

## Overview

Add AI-managed background shell execution to the AURA builder. The AI agent can spawn, monitor, and terminate background shells for long-running tasks (builds, dev servers, test suites). Active shells are visible in the top bar and as inline blocks in chat. The AI is dependency-aware — it must confirm background shells complete before starting dependent work.

## Architecture

Separate from the existing user-driven TerminalPanel. The AI explicitly decides when a command runs in the background via new agent tools. The existing `execute` tool remains for quick inline commands.

### Backend — ManagedShellService

New file: `server/services/managedShell.ts`

- `ManagedShell` interface: `{ id, name, command, cwd, pid, pty, status, exitCode, output, logPath, createdAt }`
- Status enum: `running | completed | failed | killed`
- In-memory ring buffer of 1MB per shell for recent output
- Each shell writes full output to a temp file at `.aura/shells/{shellId}.log`
- Uses `node-pty` (same as existing TerminalService) to spawn processes
- EventEmitter pattern: `shell_created`, `shell_output`, `shell_exited`, `shell_terminated`
- Methods:
  - `spawn(name, command, cwd?)` → `{ shellId, status }`
  - `writeInput(shellId, data)` — send input to running shell
  - `readOutput(shellId, lines?)` — returns recent output + status (reads from log file if needed)
  - `terminate(shellId)` — kills the process
  - `listShells()` — returns all shells with status summary
  - `getShell(shellId)` — full shell info

### Agent Tools

Four new tools in `server/services/aura/agent.ts` `defineAgentTools()`:

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `shell_spawn` | `{ name: string, command: string, cwd?: string }` | `{ shellId, name, status }` | Spawn a background shell with a descriptive name |
| `shell_read` | `{ shellId: string, tailLines?: number }` | `{ status, exitCode, recentOutput, outputTruncated?, fullLogPath? }` | Check shell output and status. `fullLogPath` is included only when `outputTruncated` is true — the AI can then use `read_file` on that path for the complete output |
| `shell_terminate` | `{ shellId: string }` | `{ success }` | Kill a running shell |
| `shell_list` | `{}` | `{ shells: [{ id, name, command, status, exitCode }] }` | List all managed shells |

The AI decides between background (`shell_spawn`) and inline (`execute`) based on expected runtime. The system prompt guides:
- Quick commands (< 10s expected): use `execute`
- Long-running commands (builds, servers, test suites): use `shell_spawn`
- **Dependency rule**: before starting work that depends on a background shell, the AI must `shell_read` to confirm it completed successfully

### SSE Events

New event types in the existing SSE stream (alongside `token`, `tool_call`, etc.):

- `shell_spawned` — `{ shellId, name, command }` — sent when AI spawns a background shell
- `shell_output` — `{ shellId, data }` — streamed terminal output (debounced, ~200ms)
- `shell_exited` — `{ shellId, exitCode, name }` — shell process exited
- `shell_terminated` — `{ shellId, name }` — AI or user killed a shell

### API Routes

New routes in `server/routes/aura.ts` or a new `server/routes/managedShell.ts`:

- `GET /api/managed-shells` — list all managed shells
- `GET /api/managed-shells/:id/output` — get shell output (reads from log file)
- `POST /api/managed-shells/:id/terminate` — user-initiated kill

### File-Backed Output

- Each shell writes output to `.aura/shells/{shellId}.log` in the project directory
- The log file is created on spawn, appended to as output arrives, and kept until the shell is dismissed
- `shell_read` returns the in-memory ring buffer (last 1MB). When output is truncated by the ring buffer, the response includes `outputTruncated: true` and `fullLogPath` (absolute path to the log file). The AI can then use its existing `read_file` tool on that path for complete output
- Log files are cleaned up when a shell is dismissed from the UI

### System Prompt Updates

Add guidance to the AI agent's system prompt:

```
## Background Shell Management

You have tools to manage background shells: shell_spawn, shell_read, shell_terminate, shell_list.

When to use background shells vs inline execute:
- Use `execute` for quick commands that complete in seconds (git status, ls, cat, quick checks)
- Use `shell_spawn` for long-running commands (npm run dev, npm run build, test suites, dev servers, watchers)

DEPENDENCY RULE: Before starting any task that depends on a background shell's completion, you MUST use `shell_read` to confirm the shell has completed successfully. Do not assume a build or install is done just because you spawned it.

Naming: Give each shell a descriptive name that reflects its purpose (e.g., "install-deps", "dev-server", "run-tests").

When a shell completes, you will be informed. Check its output before proceeding with dependent work.
```

## Frontend

### Top Bar Badge (AssistantPage.tsx)

Next to the "AURA AI" branding in the builder header:
- A badge showing the count of running background shells (e.g., "2" with a terminal icon)
- Badge is only visible when there are active shells
- Clicking the badge opens a dropdown panel listing all managed shells
- Each shell entry shows: name, command, status icon (spinner for running, checkmark for completed, X for failed)
- Clicking a shell name opens the full terminal view for that shell
- Completed/failed shells can be dismissed (closes the shell view, cleans up log file)

### Managed Terminal Panel

New component: `src/components/aura/ManagedTerminalPanel.tsx`

- Read-only xterm.js terminal showing a shell's output stream
- Header: shell name, status badge, command preview, close/dismiss button
- Subscribes to SSE events for real-time output updates
- For completed shells: shows full scrollable output with exit code
- Styled to match existing terminal themes (catppuccin dark/light)

### Inline Chat Blocks (AuraChat.tsx)

When the AI spawns a background shell, an inline block appears in the chat:
- Shows: shell name, command, status indicator (spinner while running, checkmark/X on completion)
- Clicking the block navigates to or opens the terminal view for that shell
- For inline (non-background) commands, existing tool_call display stays unchanged
- A brief indicator in the message: "Spawned background shell: install-deps"

### State Management

New hook: `src/hooks/useManagedShells.ts`

- Maintains `Map<shellId, ManagedShellState>` with: id, name, command, status, exitCode, output buffer
- Subscribes to SSE events for shell_spawned, shell_output, shell_exited, shell_terminated
- Provides: `activeShells` (running count), `shells` (all), `getShell(id)`, `dismissShell(id)`
- REST API fallback for initial state and full output reads

## Data Flow

### Spawn Flow
1. AI calls `shell_spawn` tool with name and command
2. ManagedShellService spawns a pty process, creates log file
3. Tool returns `{ shellId, name, status }` to AI
4. SSE emits `shell_spawned` event to frontend
5. Frontend adds shell to state, shows badge + inline block
6. Output streams via `shell_output` SSE events

### Completion Flow
1. Shell process exits
2. ManagedShellService updates status, records exit code
3. SSE emits `shell_exited` event to frontend
4. Frontend updates badge count, inline block status
5. AI's next turn can `shell_read` to check completion and output

### Dismiss Flow
1. User clicks dismiss on a completed/failed shell
2. Frontend calls `DELETE /api/managed-shells/:id` or dismiss via state
3. Server cleans up the log file
4. Shell removed from UI

## Error Handling

- If node-pty is unavailable, fall back to child_process.spawn (same pattern as existing TerminalService)
- Shell spawn errors (command not found, permission denied) are reported back to the AI as tool errors
- Network disconnect: shells continue running on server; reconnecting frontend re-syncs state via REST API
- Log file write failures are non-fatal — ring buffer is the primary, file is secondary

## Testing

- Unit tests for ManagedShellService (spawn, read, terminate, list)
- Integration test: AI spawns a shell, reads output, confirms completion
- Frontend: verify badge updates, terminal view renders, inline blocks appear