import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ConversationService } from '../../../server/services/conversation.ts'
import { FileStore } from '../../../server/storage/fileStore.ts'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'

const TEST_DIR = join(process.cwd(), 'data-test-conversation')

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true })
  mkdirSync(join(TEST_DIR, 'conversations'), { recursive: true })
})

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('ConversationService', () => {
  const store = new FileStore(TEST_DIR)
  const service = new ConversationService(store)

  it('creates a conversation', async () => {
    const conv = await service.create('llama3.2')
    expect(conv.id).toBeDefined()
    expect(conv.model).toBe('llama3.2')
    expect(conv.messages).toEqual([])
  })

  it('lists conversations', async () => {
    await service.create('llama3.2')
    await service.create('codellama')
    const list = await service.list()
    expect(list).toHaveLength(2)
    expect(list[0]).toHaveProperty('id')
    expect(list[0]).toHaveProperty('title')
    expect(list[0]).toHaveProperty('model')
  })

  it('gets a conversation by id', async () => {
    const created = await service.create('llama3.2')
    const fetched = await service.get(created.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.id).toBe(created.id)
  })

  it('returns null for non-existent conversation', async () => {
    const result = await service.get('nonexistent')
    expect(result).toBeNull()
  })

  it('adds a message to a conversation', async () => {
    const conv = await service.create('llama3.2')
    const updated = await service.addMessage(conv.id, { id: 'm1', role: 'user', content: 'Hello', timestamp: Date.now() })
    expect(updated.messages).toHaveLength(1)
    expect(updated.messages[0].content).toBe('Hello')
  })

  it('updates conversation title', async () => {
    const conv = await service.create('llama3.2')
    const updated = await service.updateTitle(conv.id, 'My Chat')
    expect(updated.title).toBe('My Chat')
  })

  it('updates conversation model', async () => {
    const conv = await service.create('llama3.2')
    const updated = await service.updateModel(conv.id, 'codellama')
    expect(updated.model).toBe('codellama')
  })

  it('deletes a conversation', async () => {
    const conv = await service.create('llama3.2')
    await service.delete(conv.id)
    const result = await service.get(conv.id)
    expect(result).toBeNull()
  })

  it('updates conversation summary with per-branch storage', async () => {
    const conv = await service.create('llama3.2')
    const updated = await service.updateSummary(conv.id, 'leaf-1', 'We discussed React.')
    expect(updated.summary).toBe('We discussed React.')
    expect(updated.summaries?.['leaf-1']).toBe('We discussed React.')
  })
})