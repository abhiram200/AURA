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

export interface CompactionCheckpoint {
  /** ISO timestamp when this compaction was created */
  createdAt: string
  /** The AI-generated or fallback summary text */
  summary: string
  /** Whether the summary was AI-generated (true) or a rule-based fallback (false) */
  aiGenerated: boolean
  /** IDs of AuraChatMessages covered by this summary (all messages before the checkpoint) */
  coveredMessageIds: string[]
  /** Estimated token count of the summary */
  summaryTokens: number
}

export interface AuraChatSession {
  id: string
  title: string
  messages: AuraChatMessage[]
  /** Compaction checkpoints — only the latest is used (it subsumes all prior ones) */
  compactionCheckpoints: CompactionCheckpoint[]
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
      const chat = JSON.parse(raw) as AuraChatSession
      // Migration: add compactionCheckpoints if missing (old chats)
      if (!chat.compactionCheckpoints) {
        chat.compactionCheckpoints = []
      }
      return chat
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
      compactionCheckpoints: [],
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

  /** Save only the compaction checkpoints (avoids rewriting messages) */
  async saveCheckpoints(projectPath: string, chatId: string, checkpoints: CompactionCheckpoint[]): Promise<void> {
    const chat = await this.get(projectPath)
    if (!chat || chat.id !== chatId) return
    chat.compactionCheckpoints = checkpoints
    await this.save(projectPath, chat)
  }
}