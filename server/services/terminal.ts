import { spawn as childSpawn, type ChildProcess } from 'child_process'
import { platform } from 'os'
import { createRequire } from 'module'
import type { ProjectService } from './project.ts'

// Use createRequire to bypass tsx's static import analysis.
// node-pty's native module crashes with "AttachConsole failed" when loaded
// during module scanning — this ensures it's only loaded on-demand at runtime.
const nodeRequire = createRequire(import.meta.url)

interface TerminalSession {
  pid?: number
  pty: any
  process?: ChildProcess
  ws: import('ws').WebSocket
}

export class TerminalService {
  private projectService: ProjectService
  private sessions: Map<number, TerminalSession> = new Map()
  private nextId = 1
  private ptyAvailable: boolean | null = null
  private ptyModule: any = null

  constructor(projectService: ProjectService) {
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
      console.error('node-pty unavailable, using child_process fallback:', err?.message || err)
      this.ptyAvailable = false
      return null
    }
  }

  async spawn(projectId: string, ws: import('ws').WebSocket): Promise<number> {
    const project = await this.projectService.get(projectId)
    if (!project) throw new Error('Project not found')

    const shell = platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash')
    const cwd = project.workspacePath
    const id = this.nextId++

    const pty = this.loadPty()
    if (pty) {
      // PTY mode — full terminal emulation with colors, cursor, etc.
      let ptyProcess: any
      try {
        ptyProcess = pty.spawn(shell, [], {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd,
          env: { ...process.env } as Record<string, string>,
        })
      } catch (err) {
        // PTY spawn failed, fall back to child_process
        this.ptyAvailable = false
        this.ptyModule = null
        return this.spawnWithChildProcess(shell, cwd, id, ws)
      }

      this.sessions.set(id, { pid: ptyProcess.pid, pty: ptyProcess, ws })

      ptyProcess.onData((data: string) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'stdout', data }))
        }
      })

      ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'exit', exitCode }))
        }
        this.sessions.delete(id)
      })
    } else {
      // Fallback: child_process — no PTY, limited formatting
      return this.spawnWithChildProcess(shell, cwd, id, ws)
    }

    return id
  }

  private spawnWithChildProcess(shell: string, cwd: string, id: number, ws: import('ws').WebSocket): number {
    const child = childSpawn(shell, [], {
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.sessions.set(id, { pty: null, process: child, ws })

    child.stdout?.on('data', (data: Buffer) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'stdout', data: data.toString('utf-8') }))
      }
    })

    child.stderr?.on('data', (data: Buffer) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'stdout', data: data.toString('utf-8') }))
      }
    })

    child.on('exit', (code) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', exitCode: code ?? 0 }))
      }
      this.sessions.delete(id)
    })

    child.on('error', (err) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'stdout', data: `\r\n\x1b[31m[Terminal error: ${err.message}]\x1b[0m\r\n` }))
        ws.send(JSON.stringify({ type: 'exit', exitCode: 1 }))
      }
      this.sessions.delete(id)
    })

    return id
  }

  write(id: number, data: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    if (session.pty) {
      try { session.pty.write(data) } catch { /* pty exited */ }
    } else if (session.process?.stdin?.writable) {
      session.process.stdin.write(data)
    }
  }

  resize(id: number, cols: number, rows: number): void {
    const session = this.sessions.get(id)
    if (session?.pty) {
      try { session.pty.resize(cols, rows) } catch { /* pty exited */ }
    }
    // child_process doesn't support resize — no-op for fallback mode
  }

  kill(id: number): void {
    const session = this.sessions.get(id)
    if (!session) return
    if (session.pty) {
      try { session.pty.kill() } catch { /* pty exited */ }
    } else if (session.process) {
      session.process.kill()
    }
    this.sessions.delete(id)
  }

  killAllForWs(ws: import('ws').WebSocket): void {
    for (const [id, session] of this.sessions) {
      if (session.ws === ws) {
        if (session.pty) {
          try { session.pty.kill() } catch { /* pty exited */ }
        } else if (session.process) {
          session.process.kill()
        }
        this.sessions.delete(id)
      }
    }
  }
}