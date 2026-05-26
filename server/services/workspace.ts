import { readdir, readFile, writeFile, mkdir, rm, rename, stat } from 'fs/promises'
import { watch, type FSWatcher } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { join, dirname, basename, extname, relative } from 'path'
import type { ProjectService } from './project.ts'

const execFileAsync = promisify(execFile)

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  modified?: string
}

export class WorkspaceService {
  private projectService: ProjectService

  constructor(projectService: ProjectService) {
    this.projectService = projectService
  }

  async getWorkspaceRoot(projectId: string): Promise<string | null> {
    const project = await this.projectService.get(projectId)
    if (!project) return null
    return project.workspacePath
  }

  private validatePath(workspaceRoot: string, targetPath: string): string {
    const resolved = join(workspaceRoot, targetPath)
    const rel = relative(workspaceRoot, resolved)
    if (rel.startsWith('..') || rel === '..') {
      throw new Error('Path traversal not allowed')
    }
    return resolved
  }

  async listDirectory(projectId: string, dirPath: string = '.'): Promise<FileEntry[]> {
    const root = await this.getWorkspaceRoot(projectId)
    if (!root) throw new Error('Project not found')

    const fullPath = this.validatePath(root, dirPath)
    const entries = await readdir(fullPath, { withFileTypes: true })

    const results: FileEntry[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.gitignore') continue

      const entryPath = join(dirPath, entry.name).replace(/\\/g, '/')
      if (entry.isDirectory()) {
        results.push({ name: entry.name, path: entryPath, type: 'directory' })
      } else if (entry.isFile()) {
        const filePath = join(fullPath, entry.name)
        let size: number | undefined
        let modified: string | undefined
        try {
          const s = await stat(filePath)
          size = s.size
          modified = s.mtime.toISOString()
        } catch {}
        results.push({ name: entry.name, path: entryPath, type: 'file', size, modified })
      }
    }

    results.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    return results
  }

  async readFile(projectId: string, filePath: string): Promise<{ content: string; binary: boolean }> {
    const root = await this.getWorkspaceRoot(projectId)
    if (!root) throw new Error('Project not found')

    const fullPath = this.validatePath(root, filePath)
    const s = await stat(fullPath)

    if (s.size > MAX_FILE_SIZE) {
      throw new Error('File too large (max 10MB)')
    }

    const buffer = await readFile(fullPath)
    const isBinary = this.isBinaryBuffer(buffer)
    if (isBinary) {
      return { content: '', binary: true }
    }

    return { content: buffer.toString('utf-8'), binary: false }
  }

  async writeFile(projectId: string, filePath: string, content: string): Promise<void> {
    const root = await this.getWorkspaceRoot(projectId)
    if (!root) throw new Error('Project not found')

    const fullPath = this.validatePath(root, filePath)
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, content, 'utf-8')
  }

  async createEntry(projectId: string, filePath: string, type: 'file' | 'directory'): Promise<void> {
    const root = await this.getWorkspaceRoot(projectId)
    if (!root) throw new Error('Project not found')

    const fullPath = this.validatePath(root, filePath)
    if (type === 'directory') {
      await mkdir(fullPath, { recursive: true })
    } else {
      await mkdir(dirname(fullPath), { recursive: true })
      await writeFile(fullPath, '', 'utf-8')
    }
  }

  async deleteEntry(projectId: string, filePath: string): Promise<void> {
    const root = await this.getWorkspaceRoot(projectId)
    if (!root) throw new Error('Project not found')

    const fullPath = this.validatePath(root, filePath)
    await rm(fullPath, { recursive: true, force: true })
  }

  async moveEntry(projectId: string, oldPath: string, newPath: string): Promise<void> {
    const root = await this.getWorkspaceRoot(projectId)
    if (!root) throw new Error('Project not found')

    const fullOld = this.validatePath(root, oldPath)
    const fullNew = this.validatePath(root, newPath)
    await mkdir(dirname(fullNew), { recursive: true })
    await rename(fullOld, fullNew)
  }

  async copyEntry(projectId: string, srcPath: string, destDir: string): Promise<void> {
    const root = await this.getWorkspaceRoot(projectId)
    if (!root) throw new Error('Project not found')

    const fullSrc = this.validatePath(root, srcPath)
    const fullDest = this.validatePath(root, destDir)
    const srcName = basename(fullSrc)
    const targetPath = join(fullDest, srcName)
    this.validatePath(root, join(destDir, srcName))

    const srcStat = await stat(fullSrc)
    if (srcStat.isDirectory()) {
      await this.copyDirRecursive(fullSrc, targetPath)
    } else {
      await mkdir(fullDest, { recursive: true })
      const content = await readFile(fullSrc)
      await writeFile(targetPath, content)
    }
  }

  private async copyDirRecursive(srcDir: string, destDir: string): Promise<void> {
    await mkdir(destDir, { recursive: true })
    const entries = await readdir(srcDir, { withFileTypes: true })
    for (const entry of entries) {
      const srcPath = join(srcDir, entry.name)
      const destPath = join(destDir, entry.name)
      if (entry.isDirectory()) {
        await this.copyDirRecursive(srcPath, destPath)
      } else {
        const content = await readFile(srcPath)
        await writeFile(destPath, content)
      }
    }
  }

  async searchFiles(projectId: string, query: string): Promise<FileEntry[]> {
    const root = await this.getWorkspaceRoot(projectId)
    if (!root) throw new Error('Project not found')

    const results: FileEntry[] = []
    const lowerQuery = query.toLowerCase()
    await this.walkDir(root, '.', lowerQuery, results)
    return results.slice(0, 100)
  }

  private async walkDir(root: string, relPath: string, query: string, results: FileEntry[]): Promise<void> {
    const fullPath = join(root, relPath === '.' ? '' : relPath)
    let entries
    try {
      entries = await readdir(fullPath, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (entry.name === 'node_modules' || entry.name === '.git') continue

      const entryPath = relPath === '.' ? entry.name : `${relPath}/${entry.name}`
      if (entry.name.toLowerCase().includes(query)) {
        results.push({
          name: entry.name,
          path: entryPath,
          type: entry.isDirectory() ? 'directory' : 'file',
        })
      }

      if (entry.isDirectory()) {
        await this.walkDir(root, entryPath, query, results)
      }
    }
  }

  async getGitBranch(projectId: string): Promise<string | null> {
    const root = await this.getWorkspaceRoot(projectId)
    if (!root) return null

    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root })
      return stdout.trim() || null
    } catch {
      return null
    }
  }

  async getGitStatus(projectId: string): Promise<Record<string, string>> {
    const root = await this.getWorkspaceRoot(projectId)
    if (!root) throw new Error('Project not found')

    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-z'], {
        cwd: root,
        maxBuffer: 5 * 1024 * 1024,
      })
      const statusMap: Record<string, string> = {}
      const entries = stdout.split('\0').filter(Boolean)
      for (const entry of entries) {
        const statusCode = entry.substring(0, 2)
        const filePath = entry.substring(3)
        if (!filePath) continue
        const actualPath = filePath.includes(' -> ') ? filePath.split(' -> ')[1] : filePath
        // Normalize to forward slashes for consistent matching with client paths
        const normalizedPath = actualPath.replace(/\\/g, '/')
        const index = statusCode[0], work = statusCode[1]
        let display: string
        if (index === 'R' || work === 'R') display = 'R'
        else if (index === 'D' || work === 'D') display = 'D'
        else if (index === 'A' || work === 'A') display = 'A'
        else if (index === '?' && work === '?') display = 'U'
        else if (index === 'M' || work === 'M') display = 'M'
        else display = index !== ' ' ? index : work
        if (display && display !== ' ') {
          // Filter out internal AURA/Synapse directories from git status
          if (normalizedPath.startsWith('.aura/') || normalizedPath.startsWith('.synapse/')) continue
          statusMap[normalizedPath] = display
        }
      }
      return statusMap
    } catch {
      return {}
    }
  }

  private isBinaryBuffer(buffer: Buffer): boolean {
    const len = Math.min(buffer.length, 8192)
    for (let i = 0; i < len; i++) {
      const byte = buffer[i]
      if (byte === 0) return true
    }
    return false
  }

  // File watching
  private watchers = new Map<string, FSWatcher>()
  private watchListeners = new Map<string, Set<(projectId: string, dirPath: string) => void>>()
  private gitStatusListeners = new Map<string, Set<(projectId: string) => void>>()
  private fileChangeListeners = new Map<string, Set<(projectId: string, filePath: string) => void>>()

  onFileChange(projectId: string, listener: (pid: string, dirPath: string) => void) {
    if (!this.watchListeners.has(projectId)) {
      this.watchListeners.set(projectId, new Set())
    }
    this.watchListeners.get(projectId)!.add(listener)
    return () => {
      this.watchListeners.get(projectId)?.delete(listener)
    }
  }

  onFileChangeSpecific(projectId: string, listener: (pid: string, filePath: string) => void) {
    if (!this.fileChangeListeners.has(projectId)) {
      this.fileChangeListeners.set(projectId, new Set())
    }
    this.fileChangeListeners.get(projectId)!.add(listener)
    return () => {
      this.fileChangeListeners.get(projectId)?.delete(listener)
    }
  }

  onGitStatusChange(projectId: string, listener: (pid: string) => void) {
    if (!this.gitStatusListeners.has(projectId)) {
      this.gitStatusListeners.set(projectId, new Set())
    }
    this.gitStatusListeners.get(projectId)!.add(listener)
    return () => {
      this.gitStatusListeners.get(projectId)?.delete(listener)
    }
  }

  async startWatching(projectId: string): Promise<void> {
    if (this.watchers.has(projectId)) return

    const root = await this.getWorkspaceRoot(projectId)
    if (!root) return

    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let changedDirs = new Set<string>()
    let changedFiles = new Set<string>()

    const flush = () => {
      debounceTimer = null
      const listeners = this.watchListeners.get(projectId)
      if (listeners) {
        for (const dir of changedDirs) {
          for (const fn of listeners) fn(projectId, dir)
        }
      }
      const gitListeners = this.gitStatusListeners.get(projectId)
      if (gitListeners) {
        for (const fn of gitListeners) fn(projectId)
      }
      const fileListeners = this.fileChangeListeners.get(projectId)
      if (fileListeners) {
        for (const filePath of changedFiles) {
          for (const fn of fileListeners) fn(projectId, filePath)
        }
      }
      changedDirs = new Set()
      changedFiles = new Set()
    }

    let watcher: FSWatcher
    try {
      watcher = watch(root, { recursive: true, persistent: false }, (_event, filename) => {
        if (!filename) return
        const normalized = filename.replace(/\\/g, '/')
        const parentDir = dirname(normalized)
        const dirPath = parentDir === '.' ? '.' : parentDir
        changedDirs.add(dirPath)
        changedFiles.add(normalized)

        if (!debounceTimer) {
          debounceTimer = setTimeout(flush, 300)
        }
      })
    } catch {
      // recursive watch not supported on this platform, skip watching
      return
    }

    this.watchers.set(projectId, watcher)
  }

  stopWatching(projectId: string) {
    const watcher = this.watchers.get(projectId)
    if (watcher) {
      watcher.close()
      this.watchers.delete(projectId)
    }
    this.watchListeners.delete(projectId)
    this.gitStatusListeners.delete(projectId)
    this.fileChangeListeners.delete(projectId)
  }
}