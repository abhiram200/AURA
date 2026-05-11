import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryService } from '../../../server/services/memory.ts'
import { FileStore } from '../../../server/storage/fileStore.ts'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'

const TEST_DIR = join(process.cwd(), 'data-test-memory')

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('MemoryService', () => {
  const store = new FileStore(TEST_DIR)
  const service = new MemoryService(store)

  it('lists memories (empty initially)', async () => {
    const result = await service.list()
    expect(result).toEqual([])
  })

  it('adds a memory entry', async () => {
    const entry = await service.add('User likes React', 'conv1')
    expect(entry.id).toBeDefined()
    expect(entry.fact).toBe('User likes React')
    expect(entry.active).toBe(true)
  })

  it('lists added memories', async () => {
    await service.add('Fact 1', 'conv1')
    await service.add('Fact 2', 'conv2')
    const list = await service.list()
    expect(list).toHaveLength(2)
  })

  it('updates a memory entry', async () => {
    const entry = await service.add('Original', 'conv1')
    const updated = await service.update(entry.id, { fact: 'Updated', active: false })
    expect(updated).not.toBeNull()
    expect(updated!.fact).toBe('Updated')
    expect(updated!.active).toBe(false)
  })

  it('deletes a memory entry', async () => {
    const entry = await service.add('To delete', 'conv1')
    await service.delete(entry.id)
    const list = await service.list()
    expect(list).toHaveLength(0)
  })

  it('parses extracted facts from valid JSON', () => {
    const result = service.parseExtractedFacts('["Fact A", "Fact B"]')
    expect(result).toEqual(['Fact A', 'Fact B'])
  })

  it('parses extracted facts from text with embedded JSON array', () => {
    const result = service.parseExtractedFacts('Here are the facts: ["Fact A"]')
    expect(result).toEqual(['Fact A'])
  })

  it('returns empty array for unparseable text', () => {
    const result = service.parseExtractedFacts('No facts here')
    expect(result).toEqual([])
  })

  it('returns empty array for non-array JSON', () => {
    const result = service.parseExtractedFacts('{"key": "value"}')
    expect(result).toEqual([])
  })
})