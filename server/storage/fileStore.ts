import { readFile, writeFile, unlink, mkdir, readdir } from 'fs/promises'
import { join, dirname } from 'path'

export class FileStore {
  private baseDir: string

  constructor(baseDir: string) {
    this.baseDir = baseDir
  }

  private resolvePath(filename: string): string {
    return join(this.baseDir, filename)
  }

  async ensureDir(filename: string): Promise<void> {
    const dir = dirname(this.resolvePath(filename))
    await mkdir(dir, { recursive: true })
  }

  async read<T>(filename: string, defaultValue?: T): Promise<T | null> {
    try {
      const content = await readFile(this.resolvePath(filename), 'utf-8')
      return JSON.parse(content) as T
    } catch {
      return defaultValue !== undefined ? defaultValue : null
    }
  }

  async write<T>(filename: string, data: T): Promise<void> {
    await this.ensureDir(filename)
    const content = JSON.stringify(data, null, 2)
    await writeFile(this.resolvePath(filename), content, 'utf-8')
  }

  async delete(filename: string): Promise<void> {
    try {
      await unlink(this.resolvePath(filename))
    } catch {
      // File may not exist, ignore
    }
  }

  async listFiles(subdir: string): Promise<string[]> {
    try {
      const dir = subdir ? join(this.baseDir, subdir) : this.baseDir
      const entries = await readdir(dir, { withFileTypes: true })
      return entries.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => e.name)
    } catch {
      return []
    }
  }

  async init(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true })
    await mkdir(join(this.baseDir, 'conversations'), { recursive: true })
  }
}