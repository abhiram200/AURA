import chokidar, { type FSWatcher } from 'chokidar'
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

    // Build a set of parsable extensions for filtering
    const parsableExtensions = new Set<string>()
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) {
      parsableExtensions.add(ext)
    }

    this.watcher = chokidar.watch(projectPath, {
      ignored: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/.git/**',
        '**/.aura/**',
        '**/coverage/**',
        '**/.next/**',
        '**/out/**',
        '**/.cache/**',
      ],
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
}