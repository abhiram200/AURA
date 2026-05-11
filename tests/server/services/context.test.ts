import { describe, it, expect } from 'vitest'
import { ContextService } from '../../../server/services/context.ts'
import type { Message, MemoryEntry, Settings, UserPreferences } from '../../../server/storage/types.ts'

const defaultSettings: Settings = {
  defaultModel: 'llama3.2',
  contextWindowSize: 3,
  autoExtractMemory: true,
  preferences: {
    responseDetail: null, technicalLevel: null, responseFormat: null,
    domains: null, personality: null, proactiveness: null,
    languageStyle: null, useOfExamples: null,
  },
  preferencesSet: false,
  activeSkillIds: [],
}

describe('ContextService', () => {
  const service = new ContextService()

  it('assembles system prompt + rolling window + new message', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Old msg 1', timestamp: 1 },
      { id: '2', role: 'assistant', content: 'Old reply 1', timestamp: 2 },
      { id: '3', role: 'user', content: 'Recent msg', timestamp: 3 },
      { id: '4', role: 'assistant', content: 'Recent reply', timestamp: 4 },
    ]
    const result = service.assemble(messages, 'New question', defaultSettings, [], '')
    expect(result[0].role).toBe('system')
    expect(result[result.length - 1].content).toBe('New question')
    expect(result[result.length - 1].role).toBe('user')
  })

  it('includes user preferences when set', () => {
    const settings: Settings = {
      ...defaultSettings,
      preferencesSet: true,
      preferences: {
        responseDetail: 'thorough',
        technicalLevel: 'advanced',
        responseFormat: 'code-first',
        domains: 'web dev',
        personality: 'friendly & casual',
        proactiveness: 'suggest alternatives',
        languageStyle: 'technical with explanations',
        useOfExamples: 'prefer code examples',
      },
    }
    const result = service.assemble([], 'Hi', settings, [], '')
    const prefMsg = result.find((m) => m.content.includes('[User Preferences]'))
    expect(prefMsg).toBeDefined()
    expect(prefMsg!.content).toContain('thorough')
    expect(prefMsg!.content).toContain('friendly & casual')
  })

  it('skips preferences when not set', () => {
    const result = service.assemble([], 'Hi', defaultSettings, [], '')
    const prefMsg = result.find((m) => m.content.includes('[User Preferences]'))
    expect(prefMsg).toBeUndefined()
  })

  it('includes persistent memory when present', () => {
    const memories: MemoryEntry[] = [
      { id: '1', fact: "User's name is Abhiram", source: 'conv1', active: true, createdAt: '2026-01-01' },
      { id: '2', fact: 'User prefers dark theme', source: 'conv2', active: true, createdAt: '2026-01-02' },
    ]
    const result = service.assemble([], 'Hi', defaultSettings, memories, '')
    const memMsg = result.find((m) => m.content.includes('[Remembered Facts]'))
    expect(memMsg).toBeDefined()
    expect(memMsg!.content).toContain("User's name is Abhiram")
  })

  it('excludes inactive memory entries', () => {
    const memories: MemoryEntry[] = [
      { id: '1', fact: 'Active fact', source: 'conv1', active: true, createdAt: '2026-01-01' },
      { id: '2', fact: 'Inactive fact', source: 'conv2', active: false, createdAt: '2026-01-02' },
    ]
    const result = service.assemble([], 'Hi', defaultSettings, memories, '')
    const memMsg = result.find((m) => m.content.includes('[Remembered Facts]'))
    expect(memMsg!.content).toContain('Active fact')
    expect(memMsg!.content).not.toContain('Inactive fact')
  })

  it('includes conversation summary when present', () => {
    const result = service.assemble([], 'Hi', defaultSettings, [], 'Earlier we discussed Express setup.')
    const summaryMsg = result.find((m) => m.content.includes('[Earlier Conversation Summary]'))
    expect(summaryMsg).toBeDefined()
    expect(summaryMsg!.content).toContain('Express setup')
  })

  it('respects rolling window size', () => {
    const messages: Message[] = Array.from({ length: 10 }, (_, i) => ({
      id: `${i}`, role: 'user' as const, content: `Msg ${i}`, timestamp: i,
    }))
    const result = service.assemble(messages, 'New', { ...defaultSettings, contextWindowSize: 3 }, [], '')
    const windowMsgs = result.filter((m) => m.role !== 'system')
    // Should only include last 3 messages from history plus the new message
    expect(windowMsgs.length).toBeLessThanOrEqual(4) // 3 window + 1 new
  })
})