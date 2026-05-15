import chokidar, { type FSWatcher } from 'chokidar'
import fs from 'fs/promises'
import path from 'path'
import ignore from 'ignore'
import { AuraParser } from './parser.ts'

export class AuraWatcher {
  private watcher: FSWatcher | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private changedFiles: Set<string> = new Set()

  async start(
    projectPath: string,
    onChange: (changedFiles: string[]) => void,
  ): Promise<void> {
    const parser = new AuraParser()
    await parser.init()

    // Build .gitignore-based ignore filter for the watcher
    const ig = await this.loadGitignore(projectPath)
    const alwaysIgnored = new Set([
      'node_modules', 'dist', 'build', '.git', '.aura',
      'coverage', '.next', 'out', '.cache',
    ])

    const isIgnored = (filePath: string): boolean => {
      const rel = path.relative(projectPath, filePath).replace(/\\/g, '/')
      if (!rel || rel === '') return false

      // Always-ignore hardcoded dirs
      const parts = rel.split('/')
      if (parts.some(p => alwaysIgnored.has(p))) return true

      // Check .gitignore
      if (ig && ig.ignores(rel)) return true

      return false
    }

    this.watcher = chokidar.watch(projectPath, {
      ignored: (filePath: string) => {
        // Only check parsable files — skip everything else
        if (!parser.isParsable(filePath)) {
          // Allow directories through so chokidar can walk into them,
          // but skip known-ignored directories at the directory level
          return isIgnored(filePath)
        }
        return isIgnored(filePath)
      },
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    })

    const handleChange = (filePath: string) => {
      // Only watch parsable files
      if (!parser.isParsable(filePath)) return

      this.changedFiles.add(filePath)

      // Debounce: wait 500ms before triggering onChange
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer)
      }
      this.debounceTimer = setTimeout(() => {
        const files = Array.from(this.changedFiles)
        this.changedFiles.clear()
        this.debounceTimer = null
        onChange(files)
      }, 500)
    }

    this.watcher.on('add', handleChange)
    this.watcher.on('change', handleChange)
    this.watcher.on('unlink', handleChange)

    this.watcher.on('error', (err) => {
      console.error('AURA watcher error:', err)
    })
  }

  isRunning(): boolean {
    return this.watcher !== null
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    this.changedFiles.clear()
  }

  private async loadGitignore(projectPath: string): Promise<ReturnType<typeof ignore> | null> {
    const gitignorePath = path.join(projectPath, '.gitignore')
    try {
      const content = await fs.readFile(gitignorePath, 'utf-8')
      return ignore().add(content)
    } catch {
      return null
    }
  }
}