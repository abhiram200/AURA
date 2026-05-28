import { Router } from 'express'
import type { WorkspaceService } from '../services/workspace.ts'

export function createWorkspaceRouter(workspaceService: WorkspaceService) {
  const router = Router()

  // GET /:id/files - List directory contents
  router.get('/:id/files', async (req, res) => {
    try {
      const dirPath = (req.query.path as string) || '.'
      const entries = await workspaceService.listDirectory(req.params.id, dirPath)
      res.json(entries)
    } catch (error: any) {
      if (error.message === 'Project not found') {
        res.status(404).json({ error: 'Project not found' })
      } else if (error.message.includes('traversal')) {
        res.status(403).json({ error: 'Path traversal not allowed' })
      } else {
        res.status(500).json({ error: 'Failed to list directory' })
      }
    }
  })

  // GET /:id/file - Read file contents
  router.get('/:id/file', async (req, res) => {
    try {
      const filePath = req.query.path as string
      if (!filePath) {
        res.status(400).json({ error: 'path query parameter is required' })
        return
      }
      const result = await workspaceService.readFile(req.params.id, filePath)
      res.json(result)
    } catch (error: any) {
      if (error.message === 'Project not found') {
        res.status(404).json({ error: 'Project not found' })
      } else if (error.message.includes('traversal')) {
        res.status(403).json({ error: 'Path traversal not allowed' })
      } else if (error.message.includes('too large')) {
        res.status(413).json({ error: error.message })
      } else if (error.code === 'ENOENT') {
        res.status(404).json({ error: 'File not found' })
      } else {
        res.status(500).json({ error: 'Failed to read file' })
      }
    }
  })

  // PUT /:id/file - Save file contents
  router.put('/:id/file', async (req, res) => {
    try {
      const { path: filePath, content } = req.body
      if (!filePath || typeof filePath !== 'string') {
        res.status(400).json({ error: 'path is required' })
        return
      }
      if (typeof content !== 'string') {
        res.status(400).json({ error: 'content must be a string' })
        return
      }
      await workspaceService.writeFile(req.params.id, filePath, content)
      res.json({ success: true })
    } catch (error: any) {
      if (error.message === 'Project not found') {
        res.status(404).json({ error: 'Project not found' })
      } else if (error.message.includes('traversal')) {
        res.status(403).json({ error: 'Path traversal not allowed' })
      } else {
        res.status(500).json({ error: 'Failed to save file' })
      }
    }
  })

  // POST /:id/file - Create file or directory
  router.post('/:id/file', async (req, res) => {
    try {
      const { path: filePath, type } = req.body
      if (!filePath || typeof filePath !== 'string') {
        res.status(400).json({ error: 'path is required' })
        return
      }
      if (type !== 'file' && type !== 'directory') {
        res.status(400).json({ error: 'type must be "file" or "directory"' })
        return
      }
      await workspaceService.createEntry(req.params.id, filePath, type)
      res.status(201).json({ success: true })
    } catch (error: any) {
      if (error.message === 'Project not found') {
        res.status(404).json({ error: 'Project not found' })
      } else if (error.message.includes('traversal')) {
        res.status(403).json({ error: 'Path traversal not allowed' })
      } else {
        res.status(500).json({ error: 'Failed to create entry' })
      }
    }
  })

  // DELETE /:id/file - Delete file or directory
  router.delete('/:id/file', async (req, res) => {
    try {
      const filePath = req.query.path as string
      if (!filePath) {
        res.status(400).json({ error: 'path query parameter is required' })
        return
      }
      await workspaceService.deleteEntry(req.params.id, filePath)
      res.status(204).end()
    } catch (error: any) {
      if (error.message === 'Project not found') {
        res.status(404).json({ error: 'Project not found' })
      } else if (error.message.includes('traversal')) {
        res.status(403).json({ error: 'Path traversal not allowed' })
      } else {
        res.status(500).json({ error: 'Failed to delete entry' })
      }
    }
  })

  // POST /:id/file/move - Rename/move
  router.post('/:id/file/move', async (req, res) => {
    try {
      const { oldPath, newPath } = req.body
      if (!oldPath || typeof oldPath !== 'string') {
        res.status(400).json({ error: 'oldPath is required' })
        return
      }
      if (!newPath || typeof newPath !== 'string') {
        res.status(400).json({ error: 'newPath is required' })
        return
      }
      await workspaceService.moveEntry(req.params.id, oldPath, newPath)
      res.json({ success: true })
    } catch (error: any) {
      if (error.message === 'Project not found') {
        res.status(404).json({ error: 'Project not found' })
      } else if (error.message.includes('traversal')) {
        res.status(403).json({ error: 'Path traversal not allowed' })
      } else {
        res.status(500).json({ error: 'Failed to move entry' })
      }
    }
  })

  // POST /:id/file/copy - Copy file or directory
  router.post('/:id/file/copy', async (req, res) => {
    try {
      const { srcPath, destDir } = req.body
      if (!srcPath || typeof srcPath !== 'string') {
        res.status(400).json({ error: 'srcPath is required' })
        return
      }
      if (!destDir || typeof destDir !== 'string') {
        res.status(400).json({ error: 'destDir is required' })
        return
      }
      await workspaceService.copyEntry(req.params.id, srcPath, destDir)
      res.json({ success: true })
    } catch (error: any) {
      if (error.message === 'Project not found') {
        res.status(404).json({ error: 'Project not found' })
      } else if (error.message.includes('traversal')) {
        res.status(403).json({ error: 'Path traversal not allowed' })
      } else {
        res.status(500).json({ error: 'Failed to copy entry' })
      }
    }
  })

  // GET /:id/search - Search files by name
  router.get('/:id/search', async (req, res) => {
    try {
      const query = req.query.q as string
      if (!query) {
        res.status(400).json({ error: 'q query parameter is required' })
        return
      }
      const results = await workspaceService.searchFiles(req.params.id, query)
      res.json(results)
    } catch (error: any) {
      if (error.message === 'Project not found') {
        res.status(404).json({ error: 'Project not found' })
      } else {
        res.status(500).json({ error: 'Failed to search files' })
      }
    }
  })

  // GET /:id/git-branch - Get current git branch
  router.get('/:id/git-branch', async (req, res) => {
    try {
      const branch = await workspaceService.getGitBranch(req.params.id)
      res.json({ branch })
    } catch {
      res.json({ branch: null })
    }
  })

  // GET /:id/git-status - Get git status for the entire workspace
  router.get('/:id/git-status', async (req, res) => {
    try {
      const statusMap = await workspaceService.getGitStatus(req.params.id)
      res.json(statusMap)
    } catch (error: any) {
      if (error.message === 'Project not found') {
        res.status(404).json({ error: 'Project not found' })
      } else {
        res.json({})
      }
    }
  })

  // GET /:id/git-head - Get current HEAD commit hash (for detecting commits)
  router.get('/:id/git-head', async (req, res) => {
    try {
      const head = await workspaceService.getGitHead(req.params.id)
      res.json({ head })
    } catch {
      res.json({ head: null })
    }
  })

  return router
}