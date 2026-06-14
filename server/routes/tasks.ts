import { Router } from 'express'
import type { ProjectService } from '../services/project.js'
import type { TaskService } from '../services/task.js'

export function createTasksRouter(projectService: ProjectService, taskService: TaskService) {
  const router = Router()

  // Resolve projectId to projectPath
  async function resolveProjectPath(projectId: string): Promise<string | null> {
    const project = await projectService.get(projectId)
    return project?.workspacePath ?? null
  }

  // GET /:projectId — load tasks for a project
  router.get('/:projectId', async (req, res) => {
    try {
      const { projectId } = req.params
      const projectPath = await resolveProjectPath(projectId)
      if (!projectPath) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      const data = await taskService.load(projectPath)
      res.json(data)
    } catch (error) {
      res.status(500).json({ error: 'Failed to load tasks' })
    }
  })

  // PUT /:projectId — save tasks for a project
  router.put('/:projectId', async (req, res) => {
    try {
      const { projectId } = req.params
      const projectPath = await resolveProjectPath(projectId)
      if (!projectPath) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      const { groups, items } = req.body
      if (!Array.isArray(groups) || !Array.isArray(items)) {
        res.status(400).json({ error: 'groups and items must be arrays' })
        return
      }
      await taskService.save(projectPath, { groups, items })
      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: 'Failed to save tasks' })
    }
  })

  return router
}