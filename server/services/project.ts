import { v4 as uuidv4 } from 'uuid'
import { access, rm } from 'fs/promises'
import { basename } from 'path'
import type { Project } from '../storage/types.ts'
import type { FileStore } from '../storage/fileStore.ts'

const PROJECTS_FILE = 'projects.json'

const DANGEROUS_PATHS = ['/', 'C:\\', 'C:\\Users', 'C:\\Windows', '/usr', '/etc', '/var']

function isDangerousPath(p: string): boolean {
  const normalized = p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
  return DANGEROUS_PATHS.some((dp) => normalized === dp.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, ''))
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

export class ProjectService {
  private store: FileStore

  constructor(store: FileStore) {
    this.store = store
  }

  async init(): Promise<void> {
    const existing = await this.store.read<Project[]>(PROJECTS_FILE)
    if (!existing) {
      await this.store.write(PROJECTS_FILE, [])
    }
  }

  async list(): Promise<Project[]> {
    const projects = await this.store.read<Project[]>(PROJECTS_FILE, [])
    return projects.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }

  async get(id: string): Promise<Project | null> {
    const projects = await this.list()
    return projects.find((p) => p.id === id) ?? null
  }

  async create(name: string, description: string, workspacePath: string): Promise<Project> {
    const projects = await this.store.read<Project[]>(PROJECTS_FILE, [])
    const now = new Date().toISOString()

    // Ensure name is unique — append a number if it conflicts
    const nameExists = (n: string) => projects.some(p => p.name.toLowerCase() === n.toLowerCase())
    let uniqueName = name
    if (nameExists(uniqueName)) {
      let suffix = 2
      while (nameExists(`${name}-${suffix}`)) suffix++
      uniqueName = `${name}-${suffix}`
    }

    const project: Project = {
      id: `proj_${uuidv4()}`,
      name: uniqueName,
      description: description || basename(workspacePath),
      workspacePath,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
    projects.push(project)
    await this.store.write(PROJECTS_FILE, projects)
    return project
  }

  async update(id: string, updates: Partial<Pick<Project, 'name' | 'description' | 'status' | 'workspacePath' | 'gitUrl'>>): Promise<Project | null> {
    const projects = await this.store.read<Project[]>(PROJECTS_FILE, [])
    const index = projects.findIndex((p) => p.id === id)
    if (index === -1) return null
    projects[index] = { ...projects[index], ...updates, updatedAt: new Date().toISOString() }
    await this.store.write(PROJECTS_FILE, projects)
    return projects[index]
  }

  async delete(id: string): Promise<boolean> {
    const projects = await this.store.read<Project[]>(PROJECTS_FILE, [])
    const filtered = projects.filter((p) => p.id !== id)
    if (filtered.length === projects.length) return false
    await this.store.write(PROJECTS_FILE, filtered)
    return true
  }

  async deleteWithFiles(id: string): Promise<{ deleted: boolean; pathRemoved: boolean }> {
    const projects = await this.store.read<Project[]>(PROJECTS_FILE, [])
    const project = projects.find((p) => p.id === id)
    if (!project) return { deleted: false, pathRemoved: false }

    let pathRemoved = false
    if (project.workspacePath && !isDangerousPath(project.workspacePath)) {
      const exists = await pathExists(project.workspacePath)
      if (exists) {
        try {
          await rm(project.workspacePath, { recursive: true, force: true })
          pathRemoved = true
        } catch {
          // Directory may be inaccessible
        }
      }
    }

    const filtered = projects.filter((p) => p.id !== id)
    await this.store.write(PROJECTS_FILE, filtered)
    return { deleted: true, pathRemoved }
  }

  async syncWithFilesystem(): Promise<string[]> {
    const projects = await this.store.read<Project[]>(PROJECTS_FILE, [])
    const removedIds: string[] = []

    const results = await Promise.all(
      projects.map(async (p) => {
        if (!p.workspacePath) return p
        try {
          await access(p.workspacePath)
          return p
        } catch {
          removedIds.push(p.id)
          return null
        }
      })
    )

    const kept = results.filter((p): p is Project => p !== null)
    if (kept.length !== projects.length) {
      await this.store.write(PROJECTS_FILE, kept)
    }
    return removedIds
  }
}