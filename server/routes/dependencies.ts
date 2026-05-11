// server/routes/dependencies.ts
import { Router } from 'express'
import type { GitNexusService } from '../services/gitnexus.ts'

export function createDependenciesRouter(gitnexus: GitNexusService) {
  const router = Router()

  // POST /:projectId/index — trigger indexing
  router.post('/:projectId/index', async (req, res) => {
    try {
      await gitnexus.analyzeProject(req.params.projectId)
      res.json({ status: 'indexing_started' })
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to start indexing' })
    }
  })

  // GET /:projectId/status — indexing status
  router.get('/:projectId/status', async (req, res) => {
    try {
      const status = gitnexus.getIndexingStatus(req.params.projectId)
      res.json(status)
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to get status' })
    }
  })

  // GET /:projectId/graph — full graph data
  router.get('/:projectId/graph', async (req, res) => {
    try {
      const graphData = await gitnexus.getGraph(req.params.projectId)
      res.json(graphData)
    } catch (error: any) {
      if (error.message.includes('not indexed')) {
        res.status(404).json({ error: error.message })
      } else {
        res.status(500).json({ error: error.message || 'Failed to get graph' })
      }
    }
  })

  // GET /:projectId/context — symbol context
  router.get('/:projectId/context', async (req, res) => {
    try {
      const file = req.query.file as string
      const name = req.query.name as string | undefined
      if (!file) {
        res.status(400).json({ error: 'file query parameter is required' })
        return
      }
      const context = await gitnexus.getContext(req.params.projectId, file, name)
      res.json(context)
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to get context' })
    }
  })

  // GET /:projectId/clusters — cluster list
  router.get('/:projectId/clusters', async (req, res) => {
    try {
      const clusters = await gitnexus.getClusters(req.params.projectId)
      res.json(clusters)
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to get clusters' })
    }
  })

  // GET /:projectId/installed — check if gitnexus is installed
  router.get('/:projectId/installed', async (_req, res) => {
    try {
      const installed = await gitnexus.ensureInstalled()
      res.json({ installed })
    } catch {
      res.json({ installed: false })
    }
  })

  return router
}