import fs from 'fs/promises'
import path from 'path'
import type { Group } from './aura/types.ts'

// ── Persistence ────────────────────────────────────────────────────────────────

interface StoredData {
  groups: Group[]
}

// ── GroupService ───────────────────────────────────────────────────────────────

export class GroupService {
  private groups: Map<string, Group> = new Map()
  private filePath: string

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'groups.json')
  }

  async init(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      const data: StoredData = JSON.parse(raw)
      for (const g of data.groups ?? []) {
        this.groups.set(g.id, g)
      }
    } catch {
      // File doesn't exist yet — start empty
    }
  }

  private async save(): Promise<void> {
    const dir = path.dirname(this.filePath)
    await fs.mkdir(dir, { recursive: true })
    const data: StoredData = { groups: Array.from(this.groups.values()) }
    const tmp = this.filePath + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
    await fs.rename(tmp, this.filePath)
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────────

  async list(): Promise<Group[]> {
    return Array.from(this.groups.values())
  }

  async get(id: string): Promise<Group | null> {
    return this.groups.get(id) ?? null
  }

  async create(name: string, description: string, memberProjectIds: string[]): Promise<Group> {
    const id = `grp-${Date.now()}`
    const now = new Date().toISOString()
    const group: Group = {
      id,
      name,
      description,
      memberProjectIds,
      createdAt: now,
      updatedAt: now,
    }
    this.groups.set(id, group)
    await this.save()
    return group
  }

  async update(id: string, updates: Partial<Pick<Group, 'name' | 'description'>>): Promise<Group | null> {
    const group = this.groups.get(id)
    if (!group) return null
    if (updates.name !== undefined) group.name = updates.name
    if (updates.description !== undefined) group.description = updates.description
    group.updatedAt = new Date().toISOString()
    await this.save()
    return group
  }

  async delete(id: string): Promise<boolean> {
    const existed = this.groups.delete(id)
    if (existed) await this.save()
    return existed
  }

  async addMember(groupId: string, projectId: string): Promise<Group | null> {
    const group = this.groups.get(groupId)
    if (!group) return null
    if (!group.memberProjectIds.includes(projectId)) {
      group.memberProjectIds.push(projectId)
      group.updatedAt = new Date().toISOString()
      await this.save()
    }
    return group
  }

  async removeMember(groupId: string, projectId: string): Promise<Group | null> {
    const group = this.groups.get(groupId)
    if (!group) return null
    const idx = group.memberProjectIds.indexOf(projectId)
    if (idx !== -1) {
      group.memberProjectIds.splice(idx, 1)
      group.updatedAt = new Date().toISOString()
      await this.save()
    }
    return group
  }
}