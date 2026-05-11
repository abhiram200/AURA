import { v4 as uuidv4 } from 'uuid'
import type { FileStore } from '../storage/fileStore.ts'

export interface AuraChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  parentId?: string | null
  toolCalls?: unknown[]
  subAgents?: unknown[]
}

export interface AuraChatSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface AuraChatSession {
  id: string
  projectId: string
  title: string
  messages: AuraChatMessage[]
  activeLeafId: string | null
  createdAt: string
  updatedAt: string
}

interface ProjectChatsData {
  chats: AuraChatSession[]
  activeChatId: string | null
}

export class AuraChatService {
  constructor(private store: FileStore) {}

  private filePath(projectId: string): string {
    return `aura-chats/${projectId}.json`
  }

  private async readData(projectId: string): Promise<ProjectChatsData> {
    const data = await this.store.read<ProjectChatsData>(this.filePath(projectId))
    return data ?? { chats: [], activeChatId: null }
  }

  private async writeData(projectId: string, data: ProjectChatsData): Promise<void> {
    await this.store.write(this.filePath(projectId), data)
  }

  async list(projectId: string): Promise<AuraChatSummary[]> {
    const data = await this.readData(projectId)
    return data.chats
      .map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async getActive(projectId: string): Promise<AuraChatSession | null> {
    const data = await this.readData(projectId)
    if (!data.activeChatId) return null
    return data.chats.find(c => c.id === data.activeChatId) ?? null
  }

  async create(projectId: string): Promise<AuraChatSession> {
    const data = await this.readData(projectId)
    const chat: AuraChatSession = {
      id: `ac_${uuidv4()}`,
      projectId,
      title: 'New Chat',
      messages: [],
      activeLeafId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    data.chats.unshift(chat)
    data.activeChatId = chat.id
    await this.writeData(projectId, data)
    return chat
  }

  async switchTo(projectId: string, chatId: string): Promise<AuraChatSession | null> {
    const data = await this.readData(projectId)
    const chat = data.chats.find(c => c.id === chatId)
    if (!chat) return null
    data.activeChatId = chatId
    await this.writeData(projectId, data)
    return chat
  }

  async saveMessages(
    projectId: string,
    chatId: string,
    messages: AuraChatMessage[],
    activeLeafId: string | null,
    title?: string,
  ): Promise<AuraChatSession | null> {
    const data = await this.readData(projectId)
    const chat = data.chats.find(c => c.id === chatId)
    if (!chat) return null

    chat.messages = messages
    chat.activeLeafId = activeLeafId
    chat.updatedAt = new Date().toISOString()

    if (title !== undefined) {
      chat.title = title
    } else if (chat.title === 'New Chat') {
      const firstUserMsg = messages.find(m => m.role === 'user')
      if (firstUserMsg) {
        chat.title = firstUserMsg.content.slice(0, 50).replace(/\n/g, ' ').trim() || 'New Chat'
      }
    }

    await this.writeData(projectId, data)
    return chat
  }

  async delete(projectId: string, chatId: string): Promise<boolean> {
    const data = await this.readData(projectId)
    const idx = data.chats.findIndex(c => c.id === chatId)
    if (idx === -1) return false

    data.chats.splice(idx, 1)

    if (data.activeChatId === chatId) {
      data.activeChatId = data.chats.length > 0 ? data.chats[0].id : null
    }

    await this.writeData(projectId, data)
    return true
  }
}