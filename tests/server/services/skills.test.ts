import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SkillsService } from '../../../server/services/skills.ts'
import { FileStore } from '../../../server/storage/fileStore.ts'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'

const TEST_DIR = join(process.cwd(), 'data-test-skills')

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('SkillsService', () => {
  const store = new FileStore(TEST_DIR)
  const service = new SkillsService(store)

  const sampleDefinition = {
    type: 'function' as const,
    function: {
      name: 'calculate',
      description: 'Evaluate a mathematical expression',
      parameters: {
        type: 'object',
        properties: { expression: { type: 'string', description: 'Math expression' } },
        required: ['expression'],
      },
    },
  }

  it('initializes with builtin skills', async () => {
    await service.init()
    const skills = await service.list()
    const names = skills.map((s) => s.name)
    expect(names).toContain('calculator')
    expect(names).toContain('get_weather')
  })

  it('adds a custom skill', async () => {
    await service.init()
    const skill = await service.add(sampleDefinition, { type: 'prompt' })
    expect(skill.id).toBeDefined()
    expect(skill.name).toBe('calculate')
    expect(skill.handler.type).toBe('prompt')
    expect(skill.active).toBe(true)
  })

  it('lists all skills', async () => {
    await service.init()
    const skills = await service.list()
    expect(skills.length).toBeGreaterThanOrEqual(2)
  })

  it('updates a skill', async () => {
    await service.init()
    const skill = await service.add(sampleDefinition, { type: 'prompt' })
    const updated = await service.update(skill.id, { active: false })
    expect(updated).not.toBeNull()
    expect(updated!.active).toBe(false)
  })

  it('deletes a custom skill', async () => {
    await service.init()
    const skill = await service.add(sampleDefinition, { type: 'prompt' })
    await service.delete(skill.id)
    const skills = await service.list()
    expect(skills.find((s) => s.id === skill.id)).toBeUndefined()
  })

  it('executes builtin calculator skill', async () => {
    await service.init()
    const result = await service.executeBuiltin('calculator', { expression: '2 + 3 * 4' })
    expect(result).toBe('14')
  })

  it('executes builtin weather skill', async () => {
    await service.init()
    const result = await service.executeBuiltin('weather', { city: 'London' })
    expect(result).toContain('London')
  })

  it('executes prompt handler (returns placeholder)', async () => {
    await service.init()
    const result = await service.executePrompt('calculate', { expression: '2+2' })
    expect(result).toContain('would')
  })

  it('returns active skills definitions for Ollama tools array', async () => {
    await service.init()
    await service.add(sampleDefinition, { type: 'prompt' })
    const definitions = await service.getActiveDefinitions()
    const names = definitions.map((d) => d.function.name)
    expect(names).toContain('calculate')
  })

  it('finds skill by name for tool call routing', async () => {
    await service.init()
    await service.add(sampleDefinition, { type: 'prompt' })
    const found = await service.findByName('calculate')
    expect(found).not.toBeNull()
    expect(found!.name).toBe('calculate')
  })
})