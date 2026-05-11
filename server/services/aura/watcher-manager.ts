import path from 'path'
import { AuraWatcher } from './watcher.ts'
import { AuraIndexer } from './indexer.ts'
import { AuraQueryService } from './graph.ts'

export class AuraWatcherManager {
  private watchers = new Map<string, AuraWatcher>()
  private indexingInProgress = new Map<string, boolean>()

  async startWatching(
    projectId: string,
    projectPath: string,
    indexer: AuraIndexer,
    queryService: AuraQueryService,
  ): Promise<void> {
    this.stopWatching(projectId)

    const watcher = new AuraWatcher()
    this.watchers.set(projectId, watcher)

    try {
      await watcher.start(projectPath, async (changedFiles) => {
        // Skip if already re-indexing from a previous change
        if (this.indexingInProgress.get(projectId)) return
        this.indexingInProgress.set(projectId, true)

        try {
          // Convert absolute paths from chokidar to relative paths for the indexer
          const relativeFiles = changedFiles.map(f =>
            path.relative(projectPath, f).replace(/\\/g, '/')
          )
          console.log(`AURA watcher: ${relativeFiles.length} file(s) changed in ${projectId}`)
          await indexer.incrementalIndex(relativeFiles)
          await queryService.load()
          indexer.setWatching()
        } catch (err) {
          console.error(`AURA incremental re-index failed for ${projectId}:`, err)
          indexer.setWatching()
        } finally {
          this.indexingInProgress.set(projectId, false)
        }
      })
    } catch (err) {
      console.error(`AURA failed to start watcher for ${projectId}:`, err)
      this.watchers.delete(projectId)
    }
  }

  stopWatching(projectId: string): void {
    const watcher = this.watchers.get(projectId)
    if (watcher) {
      watcher.stop()
      this.watchers.delete(projectId)
    }
  }

  stopAll(): void {
    for (const watcher of this.watchers.values()) {
      watcher.stop()
    }
    this.watchers.clear()
    this.indexingInProgress.clear()
  }
}