import { Router } from 'express'
import type { ConversationService } from '../services/conversation.ts'

export function createConversationsRouter(conversationService: ConversationService) {
  const router = Router()

  router.get('/', async (_req, res) => {
    const conversations = await conversationService.list()
    res.json({ conversations })
  })

  router.get('/:id', async (req, res) => {
    const conversation = await conversationService.get(req.params.id)
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' })
      return
    }
    res.json(conversation)
  })

  router.post('/', async (req, res) => {
    const { model } = req.body as { model?: string }
    const conversation = await conversationService.create(model ?? 'llama3.2')
    res.status(201).json(conversation)
  })

  router.put('/:id/model', async (req, res) => {
    const { model } = req.body as { model: string }
    if (!model) {
      res.status(400).json({ error: 'Model is required' })
      return
    }
    try {
      const conversation = await conversationService.updateModel(req.params.id, model)
      res.json(conversation)
    } catch {
      res.status(404).json({ error: 'Conversation not found' })
    }
  })

  router.put('/:id/title', async (req, res) => {
    const { title } = req.body as { title: string }
    if (!title || !title.trim()) {
      res.status(400).json({ error: 'Title is required' })
      return
    }
    try {
      const conversation = await conversationService.updateTitle(req.params.id, title.trim())
      res.json(conversation)
    } catch {
      res.status(404).json({ error: 'Conversation not found' })
    }
  })

  router.put('/:id/archive', async (req, res) => {
    try {
      const conversation = await conversationService.archive(req.params.id)
      res.json(conversation)
    } catch {
      res.status(404).json({ error: 'Conversation not found' })
    }
  })

  router.put('/:id/unarchive', async (req, res) => {
    try {
      const conversation = await conversationService.unarchive(req.params.id)
      res.json(conversation)
    } catch {
      res.status(404).json({ error: 'Conversation not found' })
    }
  })

  router.delete('/:id', async (req, res) => {
    await conversationService.delete(req.params.id)
    res.status(204).end()
  })

  router.delete('/', async (req, res) => {
    const { archived } = req.query as { archived?: string }
    if (archived === 'true') {
      await conversationService.deleteAll(true)
    } else if (archived === 'false') {
      await conversationService.deleteAll(false)
    } else {
      await conversationService.deleteAll()
    }
    res.status(204).end()
  })

  // Delete a specific message and all its descendants
  router.delete('/:id/messages/:messageId', async (req, res) => {
    try {
      const conversation = await conversationService.deleteMessage(req.params.id, req.params.messageId)
      res.json(conversation)
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Not found' })
    }
  })

  // Update active branch (which leaf is currently viewed)
  router.put('/:id/active-branch', async (req, res) => {
    const { leafId } = req.body as { leafId: string | null }
    try {
      const conversation = await conversationService.updateActiveLeaf(req.params.id, leafId)
      res.json(conversation)
    } catch {
      res.status(404).json({ error: 'Conversation not found' })
    }
  })

  // PATCH /api/conversations/:id/project-mode - Update project mode acceptance
  router.patch('/:id/project-mode', async (req, res) => {
    try {
      const { id } = req.params
      const { accepted } = req.body
      if (typeof accepted !== 'boolean') {
        res.status(400).json({ error: 'accepted must be a boolean' })
        return
      }
      const conversation = await conversationService.updateProjectModeAccepted(id, accepted)
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' })
        return
      }
      res.json(conversation)
    } catch (error) {
      res.status(500).json({ error: 'Failed to update project mode acceptance' })
    }
  })

  // PATCH /api/conversations/:id/project - Link/unlink a project to a conversation
  router.patch('/:id/project', async (req, res) => {
    try {
      const { id } = req.params
      const { projectId } = req.body
      if (typeof projectId !== 'string' && projectId !== null) {
        res.status(400).json({ error: 'projectId must be a string or null' })
        return
      }
      const conversation = await conversationService.updateProjectId(id, projectId)
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' })
        return
      }
      res.json(conversation)
    } catch (error) {
      res.status(500).json({ error: 'Failed to update project' })
    }
  })

  return router
}