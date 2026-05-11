import { v4 as uuidv4 } from 'uuid'
import type { Conversation, Message } from '../storage/types.ts'
import type { FileStore } from '../storage/fileStore.ts'

export class ConversationService {
  private store: FileStore

  constructor(store: FileStore) {
    this.store = store
  }

  async create(model: string): Promise<Conversation> {
    const id = uuidv4()
    const now = Date.now()
    const conversation: Conversation = {
      id,
      title: 'New Conversation',
      messages: [],
      model,
      summary: '',
      createdAt: now,
      updatedAt: now,
    }
    await this.store.write(`conversations/${id}.json`, conversation)
    return conversation
  }

  async list(): Promise<Pick<Conversation, 'id' | 'title' | 'model' | 'updatedAt' | 'archived'>[]> {
    const files = await this.store.listFiles('conversations')
    const conversations: Pick<Conversation, 'id' | 'title' | 'model' | 'updatedAt' | 'archived'>[] = []
    for (const file of files) {
      const conv = await this.store.read<Conversation>(`conversations/${file}`)
      if (conv) {
        conversations.push({ id: conv.id, title: conv.title, model: conv.model, updatedAt: conv.updatedAt, archived: conv.archived ?? false })
      }
    }
    return conversations.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async get(id: string): Promise<Conversation | null> {
    const conv = await this.store.read<Conversation>(`conversations/${id}.json`)
    if (conv && !conv.summaries) {
      conv.summaries = {}
      if (conv.summary && conv.activeLeafId) {
        conv.summaries[conv.activeLeafId] = conv.summary
      }
    }
    return conv
  }

  async addMessage(id: string, message: Message): Promise<Conversation> {
    const conv = await this.get(id)
    if (!conv) throw new Error(`Conversation ${id} not found`)
    conv.messages.push(message)
    conv.activeLeafId = message.id
    conv.updatedAt = Date.now()
    await this.store.write(`conversations/${id}.json`, conv)
    return conv
  }

  async updateTitle(id: string, title: string): Promise<Conversation> {
    const conv = await this.get(id)
    if (!conv) throw new Error(`Conversation ${id} not found`)
    conv.title = title
    conv.updatedAt = Date.now()
    await this.store.write(`conversations/${id}.json`, conv)
    return conv
  }

  async updateModel(id: string, model: string): Promise<Conversation> {
    const conv = await this.get(id)
    if (!conv) throw new Error(`Conversation ${id} not found`)
    conv.model = model
    conv.updatedAt = Date.now()
    await this.store.write(`conversations/${id}.json`, conv)
    return conv
  }

  async updateSummary(id: string, leafId: string, summary: string): Promise<Conversation> {
    const conv = await this.get(id)
    if (!conv) throw new Error(`Conversation ${id} not found`)
    if (!conv.summaries) conv.summaries = {}
    conv.summaries[leafId] = summary
    conv.summary = summary
    conv.updatedAt = Date.now()
    await this.store.write(`conversations/${id}.json`, conv)
    return conv
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(`conversations/${id}.json`)
  }

  async deleteAll(archived?: boolean): Promise<void> {
    const conversations = await this.list()
    const toDelete = archived === undefined
      ? conversations
      : archived
        ? conversations.filter((c) => c.archived)
        : conversations.filter((c) => !c.archived)
    for (const c of toDelete) {
      await this.store.delete(`conversations/${c.id}.json`)
    }
  }

  async archive(id: string): Promise<Conversation> {
    const conv = await this.get(id)
    if (!conv) throw new Error(`Conversation ${id} not found`)
    conv.archived = true
    conv.updatedAt = Date.now()
    await this.store.write(`conversations/${id}.json`, conv)
    return conv
  }

  async unarchive(id: string): Promise<Conversation> {
    const conv = await this.get(id)
    if (!conv) throw new Error(`Conversation ${id} not found`)
    conv.archived = false
    conv.updatedAt = Date.now()
    await this.store.write(`conversations/${id}.json`, conv)
    return conv
  }

  async updateMessages(id: string, messages: Message[]): Promise<Conversation> {
    const conv = await this.get(id)
    if (!conv) throw new Error(`Conversation ${id} not found`)
    conv.messages = messages
    conv.updatedAt = Date.now()
    await this.store.write(`conversations/${id}.json`, conv)
    return conv
  }

  async updateActiveLeaf(id: string, leafId: string | null): Promise<Conversation> {
    const conv = await this.get(id)
    if (!conv) throw new Error(`Conversation ${id} not found`)
    conv.activeLeafId = leafId
    conv.updatedAt = Date.now()
    await this.store.write(`conversations/${id}.json`, conv)
    return conv
  }

  async updateProjectModeAccepted(id: string, accepted: boolean): Promise<Conversation | null> {
    const conversation = await this.get(id)
    if (!conversation) return null
    conversation.projectModeAccepted = accepted
    conversation.updatedAt = Date.now()
    await this.store.write(`conversations/${id}.json`, conversation)
    return conversation
  }

  async updateProjectId(id: string, projectId: string | null): Promise<Conversation | null> {
    const conversation = await this.get(id)
    if (!conversation) return null
    conversation.projectId = projectId
    conversation.updatedAt = Date.now()
    await this.store.write(`conversations/${id}.json`, conversation)
    return conversation
  }

  /** Get the active path of messages from root to activeLeafId */
  getActivePath(messages: Message[], leafId: string | null): Message[] {
    if (!leafId || messages.length === 0) return messages

    const msgMap = new Map(messages.map(m => [m.id, m]))
    const leaf = msgMap.get(leafId)
    if (!leaf) return messages

    const path: Message[] = []
    let current: Message | undefined = leaf
    while (current) {
      path.unshift(current)
      current = current.parentId ? msgMap.get(current.parentId) : undefined
    }
    return path
  }

  /** Get sibling messages (same parentId) for a given message */
  getSiblings(messages: Message[], parentId: string | null | undefined): Message[] {
    return messages.filter(m => (m.parentId ?? null) === (parentId ?? null))
  }

  /** Delete a message and all its descendants */
  async deleteMessage(id: string, messageId: string): Promise<Conversation> {
    const conv = await this.get(id)
    if (!conv) throw new Error(`Conversation ${id} not found`)

    const toDelete = new Set<string>()
    const collectDescendants = (parentId: string) => {
      toDelete.add(parentId)
      for (const msg of conv.messages) {
        if (msg.parentId === parentId) {
          collectDescendants(msg.id)
        }
      }
    }
    collectDescendants(messageId)

    conv.messages = conv.messages.filter(m => !toDelete.has(m.id))

    // If activeLeafId was deleted, reset to last message or null
    if (conv.activeLeafId && toDelete.has(conv.activeLeafId)) {
      conv.activeLeafId = conv.messages.length > 0 ? conv.messages[conv.messages.length - 1].id : null
    }

    conv.updatedAt = Date.now()
    await this.store.write(`conversations/${id}.json`, conv)
    return conv
  }
}