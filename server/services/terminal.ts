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

  constructor(projectService: ProjectService) {
    this.projectService = projectService
  }

  async spawn(projectId: string, ws: import('ws').WebSocket): Promise<number> {
    const project = await this.projectService.get(projectId)
    if (!project) throw new Error('Project not found')

    const pty = await import('node-pty')
    const shell = platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash')
    const cwd = project.workspacePath

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: { ...process.env } as Record<string, string>,
    })

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
      session.pty.write(data)
    }
  }

  resize(id: number, cols: number, rows: number): void {
    const session = this.sessions.get(id)
    if (session) {
      session.pty.resize(cols, rows)
    }
  }

  kill(id: number): void {
    const session = this.sessions.get(id)
    if (session) {
      session.pty.kill()
      this.sessions.delete(id)
    }
  }

  killAllForWs(ws: import('ws').WebSocket): void {
    for (const [id, session] of this.sessions) {
      if (session.ws === ws) {
        session.pty.kill()
        this.sessions.delete(id)
      }
    }
  }
}