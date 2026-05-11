import { Router } from 'express'
import type { MemoryService } from '../services/memory.ts'

export function createMemoryRouter(memoryService: MemoryService) {
  const router = Router()

  router.get('/', async (_req, res) => {
    const memories = await memoryService.list()
    res.json({ memories })
  })

  router.post('/', async (req, res) => {
    const { fact } = req.body as { fact: string }
    if (!fact) {
      res.status(400).json({ error: 'fact is required' })
      return
    }
    const entry = await memoryService.add(fact, 'manual')
    res.status(201).json(entry)
  })

  router.put('/:id', async (req, res) => {
    const updates = req.body as { fact?: string; active?: boolean }
    const entry = await memoryService.update(req.params.id, updates)
    if (!entry) {
      res.status(404).json({ error: 'Memory not found' })
      return
    }
    res.json(entry)
  })

  router.delete('/:id', async (req, res) => {
    await memoryService.delete(req.params.id)
    res.status(204).end()
  })

  router.delete('/', async (_req, res) => {
    await memoryService.deleteAll()
    res.status(204).end()
  })

  return router
}