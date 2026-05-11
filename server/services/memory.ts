import { v4 as uuidv4 } from 'uuid'
import { MEMORY_EXTRACT, MEMORY_COMPACT } from '../prompts.ts'
import type { MemoryEntry } from '../storage/types.ts'
import type { FileStore } from '../storage/fileStore.ts'

export class MemoryService {
  private store: FileStore

  constructor(store: FileStore) {
    this.store = store
  }

  async list(): Promise<MemoryEntry[]> {
    return this.store.read<MemoryEntry[]>('memory.json', [])
  }

  async add(fact: string, source: string): Promise<MemoryEntry> {
    const entries = await this.list()
    const entry: MemoryEntry = {
      id: `mem_${uuidv4()}`,
      fact,
      source,
      active: true,
      createdAt: new Date().toISOString(),
    }
    entries.push(entry)
    await this.store.write('memory.json', entries)
    return entry
  }

  async update(id: string, updates: Partial<Pick<MemoryEntry, 'fact' | 'active'>>): Promise<MemoryEntry | null> {
    const entries = await this.list()
    const index = entries.findIndex((e) => e.id === id)
    if (index === -1) return null
    entries[index] = { ...entries[index], ...updates }
    await this.store.write('memory.json', entries)
    return entries[index]
  }

  async delete(id: string): Promise<void> {
    const entries = await this.list()
    const filtered = entries.filter((e) => e.id !== id)
    await this.store.write('memory.json', filtered)
  }

  async deleteAll(): Promise<void> {
    await this.store.write('memory.json', [])
  }

  parseExtractedFacts(raw: string): string[] {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string')
      }
    } catch {
      const match = raw.match(/\[[\s\S]*\]/)
      if (match) {
        try {
          const parsed = JSON.parse(match[0])
          if (Array.isArray(parsed)) {
            return parsed.filter((item): item is string => typeof item === 'string')
          }
        } catch {
          // Regex match also failed to parse
        }
      }
    }
    return []
  }

  async extractAndSave(userMessage: string, assistantMessage: string, source: string, ollamaChatFn: (messages: { role: string; content: string }[]) => Promise<string>): Promise<string[]> {
    const existing = await this.list()
    const existingFacts = existing.map((e) => e.fact.toLowerCase().trim())

    const prompt = `${MEMORY_EXTRACT}
${existingFacts.length > 0 ? existingFacts.map((f) => `- ${f}`).join('\n') : '(none)'}

Exchange:
User: ${userMessage}
Assistant: ${assistantMessage}`

    try {
      const raw = await ollamaChatFn([{ role: 'user', content: prompt }])
      const facts = this.parseExtractedFacts(raw)
      const newFacts: string[] = []
      for (const fact of facts) {
        const normalized = fact.toLowerCase().trim()
        if (!existingFacts.includes(normalized)) {
          await this.add(fact, source)
          existingFacts.push(normalized)
          newFacts.push(fact)
        }
      }
      return newFacts
    } catch {
      return []
    }
  }

  async compactIfNeeded(ollamaChatFn: (messages: { role: string; content: string }[]) => Promise<string>): Promise<void> {
    const entries = await this.list()
    if (entries.length <= 10) return

    const activeEntries = entries.filter((e) => e.active)
    if (activeEntries.length <= 10) return

    const entryList = activeEntries.map((e) => `- ${e.fact}`).join('\n')
    const raw = await ollamaChatFn([{ role: 'user', content: `${MEMORY_COMPACT}\n${entryList}` }])
    const mergedFacts = this.parseExtractedFacts(raw)

    if (mergedFacts.length === 0) return

    // Replace all active entries with the compacted ones
    const inactiveEntries = entries.filter((e) => !e.active)
    const newEntries: MemoryEntry[] = [
      ...inactiveEntries,
      ...mergedFacts.map((fact) => ({
        id: `mem_${uuidv4()}`,
        fact,
        source: 'compaction',
        active: true,
        createdAt: new Date().toISOString(),
      })),
    ]
    await this.store.write('memory.json', newEntries)
  }
}