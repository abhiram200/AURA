import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import fs from 'fs/promises'

export interface AuraChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  toolCalls?: unknown[]
  subAgents?: unknown[]
}

export interface AuraChatSession {
  id: string
  title: string
  messages: AuraChatMessage[]
  createdAt: string
  updatedAt: string
}

export class AuraChatService {
  private chatPath(projectPath: string): string {
    return path.join(projectPath, '.aura', 'chat.json')
  }

  private async ensureDir(projectPath: string): Promise<void> {
    await fs.mkdir(path.join(projectPath, '.aura'), { recursive: true })
  }

  async get(projectPath: string): Promise<AuraChatSession | null> {
    try {
      const raw = await fs.readFile(this.chatPath(projectPath), 'utf-8')
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  async create(projectPath: string): Promise<AuraChatSession> {
    await this.ensureDir(projectPath)
    const chat: AuraChatSession = {
      id: `ac_${uuidv4()}`,
      title: 'New Chat',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await fs.writeFile(this.chatPath(projectPath), JSON.stringify(chat, null, 2), 'utf-8')
    return chat
  }

  async save(projectPath: string, chat: AuraChatSession): Promise<void> {
    await this.ensureDir(projectPath)
    chat.updatedAt = new Date().toISOString()
    if (chat.title === 'New Chat') {
      const firstUserMsg = chat.messages.find(m => m.role === 'user')
      if (firstUserMsg) {
        chat.title = firstUserMsg.content.slice(0, 50).replace(/\n/g, ' ').trim() || 'New Chat'
      }
    }
    await fs.writeFile(this.chatPath(projectPath), JSON.stringify(chat, null, 2), 'utf-8')
  }
}