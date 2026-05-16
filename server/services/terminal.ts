import { join } from 'path'
import { platform } from 'os'
import type { ProjectService } from './project.ts'

interface TerminalSession {
  pid: number
  pty: import('node-pty').IPty
  ws: import('ws').WebSocket
}

export class TerminalService {
  private projectService: ProjectService
  private sessions: Map<number, TerminalSession> = new Map()
  private nextId = 1
  private ptyModule: typeof import('node-pty') | null = null
  private ptyLoadFailed = false

  constructor(projectService: ProjectService) {
    this.projectService = projectService
  }

  private async loadPty(): Promise<typeof import('node-pty') | null> {
    if (this.ptyModule) return this.ptyModule
    if (this.ptyLoadFailed) return null
    try {
      this.ptyModule = await import('node-pty')
      return this.ptyModule
    } catch (err) {
      console.error('Failed to load node-pty, terminal will be unavailable:', err)
      this.ptyLoadFailed = true
      return null
    }
  }

  async spawn(projectId: string, ws: import('ws').WebSocket): Promise<number> {
    const project = await this.projectService.get(projectId)
    if (!project) throw new Error('Project not found')

    const pty = await this.loadPty()
    if (!pty) throw new Error('Terminal unavailable: node-pty failed to load')

    const shell = platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash')
    const cwd = project.workspacePath

    let ptyProcess: import('node-pty').IPty
    try {
      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd,
        env: { ...process.env } as Record<string, string>,
      })
    } catch (err) {
      throw new Error(`Failed to spawn terminal: ${err instanceof Error ? err.message : String(err)}`)
    }

    const id = this.nextId++
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

    return id
  }

  write(id: number, data: string): void {
    const session = this.sessions.get(id)
    if (session) {
      try {
        session.pty.write(data)
      } catch {
        // pty process may have already exited
      }
    }
  }

  resize(id: number, cols: number, rows: number): void {
    const session = this.sessions.get(id)
    if (session) {
      try {
        session.pty.resize(cols, rows)
      } catch {
        // pty process may have already exited
      }
    }
  }

  kill(id: number): void {
    const session = this.sessions.get(id)
    if (session) {
      try {
        session.pty.kill()
      } catch {
        // pty process may have already exited
      }
      this.sessions.delete(id)
    }
  }

  killAllForWs(ws: import('ws').WebSocket): void {
    for (const [id, session] of this.sessions) {
      if (session.ws === ws) {
        try {
          session.pty.kill()
        } catch {
          // pty process may have already exited
        }
        this.sessions.delete(id)
      }
    }
  }
}