// server/services/managedShell.ts
import { spawn as childSpawn, type ChildProcess, execSync } from 'child_process'
import { platform } from 'os'
import { createRequire } from 'module'
import { mkdirSync, appendFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import type { ProjectService } from './project.ts'
import { EventEmitter } from 'events'

const nodeRequire = createRequire(import.meta.url)

const isWindows = platform() === 'win32'

// Strip ANSI escape sequences so output is readable by the AI agent
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b\[[0-9;]*[a-zA-Z][a-zA-Z]|\x1b[\(\)][B0UK]|\x1b\[\?[0-9;]*[a-zA-Z]|\r/g

function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, '')
    .replace(/\n{3,}/g, '\n\n') // collapse excessive blank lines
    .trim()
}

// Kill an entire process tree (parent + all descendants).
// On Windows, child_process.kill() only kills the direct parent,
// orphaning child processes (e.g., npm run dev survives killing cmd.exe).
function killProcessTree(pid: number): void {
  if (isWindows) {
    // Step 1: Kill the process tree using taskkill
    try {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'pipe', windowsHide: true, timeout: 5000 })
      console.log(`[ManagedShell] taskkill /T /F succeeded for PID ${pid}`)
    } catch (err: any) {
      console.error(`[ManagedShell] taskkill /T /F failed for PID ${pid}:`, err?.message || err)
      // Step 2: If taskkill /T failed, try killing just the process and its direct children
      try {
        // Find child processes and kill them individually
        const wmicOut = execSync(
          `wmic process where "ParentProcessId=${pid}" get ProcessId /format:list`,
          { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, timeout: 5000, encoding: 'utf-8' }
        )
        const childPids = wmicOut.split('\n')
          .map((l: string) => l.replace('ProcessId=', '').trim())
          .filter((l: string) => /^\d+$/.test(l))
        for (const cpid of childPids) {
          try {
            execSync(`taskkill /pid ${cpid} /F`, { stdio: 'ignore', windowsHide: true })
            console.log(`[ManagedShell] Killed child PID ${cpid}`)
          } catch { /* child already dead */ }
        }
      } catch {
        console.error(`[ManagedShell] wmic enumeration failed for PID ${pid}`)
      }
      // Step 3: Kill the parent itself
      try {
        process.kill(pid)
        console.log(`[ManagedShell] process.kill succeeded for PID ${pid}`)
      } catch {
        console.error(`[ManagedShell] process.kill also failed for PID ${pid} — process may already be dead`)
      }
    }
  } else {
    // On Unix, kill the process group (negative PID)
    try {
      process.kill(-pid, 'SIGKILL')
      console.log(`[ManagedShell] Killed process group ${-pid}`)
    } catch (err: any) {
      console.error(`[ManagedShell] process.kill(-${pid}) failed:`, err?.message || err)
      try { process.kill(pid, 'SIGKILL') } catch { /* already dead */ }
    }
  }
}

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
  output: string
  logPath: string
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

export interface CrashReport {
  shellId: string
  name: string
  command: string
  exitCode: number
  recentOutput: string
  timestamp: number
}

const MAX_BUFFER_SIZE = 1024 * 1024 // 1MB ring buffer

export class ManagedShellService extends EventEmitter {
  private projectService: ProjectService
  private shells: Map<string, ManagedShell> = new Map()
  private crashReports: Map<string, CrashReport[]> = new Map()
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

    if (pty) {
      try {
        // Run the command directly via cmd/sh — NOT through an interactive shell.
        // Spawning powershell.exe and writing the command to it causes two problems:
        // 1. PowerShell buffers child process output, so npm/vite output never reaches onData
        // 2. The interactive shell never exits when the command finishes, so onExit never fires
        const shellBin = isWindows ? 'cmd' : (process.env.SHELL || '/bin/sh')
        const shellArgs = isWindows ? ['/c', command] : ['-c', command]

        const ptyProcess = pty.spawn(shellBin, shellArgs, {
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
          try { appendFileSync(logPath, data) } catch { /* log write failed — non-fatal */ }
          this.emit('event', { type: 'shell_output', shellId: id, data } as ShellEvent)
        })

        ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
          // Don't overwrite 'killed' status if terminate() already marked it
          if (shell.status === 'killed') {
            this.emit('event', { type: 'shell_exited', shellId: id, exitCode: -1, name } as ShellEvent)
            return
          }
          shell.status = exitCode === 0 ? 'completed' : 'failed'
          shell.exitCode = exitCode
          shell.finishedAt = Date.now()
          this.emit('event', { type: 'shell_exited', shellId: id, exitCode, name } as ShellEvent)
          if (exitCode !== 0 && exitCode !== -1) {
            this.addCrashReport(shell, exitCode)
          }
        })
      } catch (err) {
        // PTY spawn failed, fall back to child_process
        this.ptyAvailable = false
        this.ptyModule = null
        this.spawnWithChildProcess(shell, command, workingDir)
        this.shells.set(id, shell)
        this.emit('event', { type: 'shell_spawned', shellId: id, name, command } as ShellEvent)
        return shell
      }
    } else {
      this.spawnWithChildProcess(shell, command, workingDir)
    }

    this.shells.set(id, shell)
    this.emit('event', { type: 'shell_spawned', shellId: id, name, command } as ShellEvent)
    return shell
  }

  private spawnWithChildProcess(shell: ManagedShell, command: string, workingDir: string): void {
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
      try { appendFileSync(shell.logPath, str) } catch { /* non-fatal */ }
      this.emit('event', { type: 'shell_output', shellId: shell.id, data: str } as ShellEvent)
    })

    child.stderr?.on('data', (data: Buffer) => {
      const str = data.toString('utf-8')
      this.appendToOutput(shell, str)
      try { appendFileSync(shell.logPath, str) } catch { /* non-fatal */ }
      this.emit('event', { type: 'shell_output', shellId: shell.id, data: str } as ShellEvent)
    })

    child.on('exit', (code) => {
      // Don't overwrite 'killed' status if terminate() already marked it
      if (shell.status === 'killed') {
        this.emit('event', { type: 'shell_exited', shellId: shell.id, exitCode: -1, name: shell.name } as ShellEvent)
        return
      }
      const exitCode = code ?? 0
      shell.status = exitCode === 0 ? 'completed' : 'failed'
      shell.exitCode = exitCode
      shell.finishedAt = Date.now()
      this.emit('event', { type: 'shell_exited', shellId: shell.id, exitCode, name: shell.name } as ShellEvent)
      if (exitCode !== 0 && exitCode !== -1) {
        this.addCrashReport(shell, exitCode)
      }
    })

    child.on('error', (err) => {
      if (shell.status === 'killed') return
      const errMsg = `\r\n\x1b[31m[Shell error: ${err.message}]\x1b[0m\r\n`
      this.appendToOutput(shell, errMsg)
      try { appendFileSync(shell.logPath, errMsg) } catch { /* non-fatal */ }
      shell.status = 'failed'
      shell.exitCode = 1
      shell.finishedAt = Date.now()
      this.emit('event', { type: 'shell_exited', shellId: shell.id, exitCode: 1, name: shell.name } as ShellEvent)
      this.addCrashReport(shell, 1)
    })
  }

  private appendToOutput(shell: ManagedShell, data: string): void {
    shell.output += data
    // Ring buffer: trim if exceeds max size
    if (shell.output.length > MAX_BUFFER_SIZE) {
      shell.output = shell.output.slice(shell.output.length - MAX_BUFFER_SIZE)
    }
  }

  readOutput(shellId: string, tailLines?: number, cleanOutput?: boolean): { status: ManagedShellStatus; exitCode: number | null; recentOutput: string; outputTruncated: boolean; fullLogPath?: string } | null {
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

    // Strip ANSI escape sequences for AI agent readability
    if (cleanOutput) {
      output = stripAnsi(output)
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
    if (!shell || shell.status !== 'running') {
      console.log(`[ManagedShell] Cannot terminate ${shellId}: status=${shell?.status ?? 'not found'}`)
      return false
    }

    console.log(`[ManagedShell] Terminating ${shellId} (name=${shell.name}, pid=${shell.pid}, pty=${!!shell.pty})`)

    // Mark as killed FIRST to prevent onExit handlers from overwriting status
    shell.status = 'killed'
    shell.exitCode = -1
    shell.finishedAt = Date.now()

    // Kill the entire process tree before killing the parent,
    // so child processes (npm run dev, etc.) don't become orphaned.
    const pid = shell.pid
    if (pid) {
      killProcessTree(pid)
    }

    // Now clean up the parent process / PTY
    if (shell.pty) {
      try {
        shell.pty.kill()
        console.log(`[ManagedShell] PTY kill succeeded for ${shellId}`)
      } catch (err: any) {
        console.log(`[ManagedShell] PTY kill threw (expected if process already dead):`, err?.message || err)
      }
    } else if (shell.process) {
      try {
        shell.process.kill()
        console.log(`[ManagedShell] process.kill succeeded for ${shellId}`)
      } catch (err: any) {
        console.log(`[ManagedShell] process.kill threw (expected if process already dead):`, err?.message || err)
      }
    }

    this.emit('event', { type: 'shell_terminated', shellId, name: shell.name } as ShellEvent)
    console.log(`[ManagedShell] Shell ${shellId} terminated`)
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

  private addCrashReport(shell: ManagedShell, exitCode: number): void {
    const report: CrashReport = {
      shellId: shell.id,
      name: shell.name,
      command: shell.command,
      exitCode,
      recentOutput: stripAnsi(shell.output.slice(-4096)),
      timestamp: Date.now(),
    }
    const existing = this.crashReports.get(shell.projectId) || []
    existing.push(report)
    this.crashReports.set(shell.projectId, existing)
    console.log(`[ManagedShell] Crash report created for ${shell.name} (${shell.id}), exit code ${exitCode}`)
  }

  getCrashReports(projectId: string): CrashReport[] {
    return this.crashReports.get(projectId) || []
  }

  clearCrashReport(projectId: string, shellId: string): void {
    const reports = this.crashReports.get(projectId)
    if (!reports) return
    const idx = reports.findIndex(r => r.shellId === shellId)
    if (idx !== -1) {
      reports.splice(idx, 1)
      if (reports.length === 0) this.crashReports.delete(projectId)
    }
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