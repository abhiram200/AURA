import path from 'path'
import fs from 'fs/promises'
import type { TaskData } from '../storage/types.js'

const DEFAULT_DATA: TaskData = { groups: [], items: [] }

export class TaskService {
  private filePath(projectPath: string): string {
    return path.join(projectPath, '.aura', 'tasks.json')
  }

  private async ensureDir(projectPath: string): Promise<void> {
    await fs.mkdir(path.join(projectPath, '.aura'), { recursive: true })
  }

  async load(projectPath: string): Promise<TaskData> {
    try {
      const raw = await fs.readFile(this.filePath(projectPath), 'utf-8')
      return JSON.parse(raw) as TaskData
    } catch {
      return { ...DEFAULT_DATA, groups: [], items: [] }
    }
  }

  async save(projectPath: string, data: TaskData): Promise<void> {
    await this.ensureDir(projectPath)
    await fs.writeFile(this.filePath(projectPath), JSON.stringify(data, null, 2), 'utf-8')
  }
}