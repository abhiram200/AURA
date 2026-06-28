import { Router } from 'express'
import { OllamaService } from '../services/ollama.ts'
import { isEmbeddingModel, hasVisionCapability } from '../services/aura/utils/model-utils.ts'
import type { FileStore } from '../storage/fileStore.ts'
import type { Settings } from '../storage/types.ts'

export function createModelsRouter(ollama: OllamaService, store: FileStore) {
  const router = Router()

  router.get('/', async (_req, res) => {
    try {
      const models = await ollama.listModels()
      const classifiedModels = models.map(m => ({
        ...m,
        isEmbedding: isEmbeddingModel(m.name),
        isVision: hasVisionCapability(m),
      }))
      res.json({ models: classifiedModels })
    } catch (err) {
      res.status(502).json({ error: `Failed to fetch models: ${err instanceof Error ? err.message : 'Unknown error'}` })
    }
  })

  return router
}