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

    if (pty) {
      try {
        const ptyProcess = pty.spawn(platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash'), [], {
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
          shell.status = exitCode === 0 ? 'completed' : 'failed'
          shell.exitCode = exitCode
          shell.finishedAt = Date.now()
          this.emit('event', { type: 'shell_exited', shellId: id, exitCode, name } as ShellEvent)
        })

        // Send the command to the pty
        ptyProcess.write(command + '\n')
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
      shell.status = code === 0 ? 'completed' : 'failed'
      shell.exitCode = code ?? 0
      shell.finishedAt = Date.now()
      this.emit('event', { type: 'shell_exited', shellId: shell.id, exitCode: code ?? 0, name: shell.name } as ShellEvent)
    })

    child.on('error', (err) => {
      const errMsg = `\r\n\x1b[31m[Shell error: ${err.message}]\x1b[0m\r\n`
      this.appendToOutput(shell, errMsg)
      try { appendFileSync(shell.logPath, errMsg) } catch { /* non-fatal */ }
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