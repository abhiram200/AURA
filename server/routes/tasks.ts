import { Router } from 'express'
import type { TaskService } from '../services/task.ts'

/**
 * Creates task routes.
 * Mounted at /api/projects, so routes here define the :projectId param themselves.
 * This ensures Express 5 correctly extracts :projectId from req.params.
 */
export function createTasksRouter(taskService: TaskService) {
  const router = Router({ mergeParams: true })

  // GET /api/projects/:projectId/tasks — fetch full task state for a project
  router.get('/:projectId/tasks', async (req, res) => {
    try {
      const { projectId } = req.params
      const data = await taskService.getTaskData(projectId)
      res.json(data)
    } catch (error) {
      console.error('Failed to get task data:', error)
      res.status(500).json({ error: 'Failed to get task data' })
    }
  })

  // PUT /api/projects/:projectId/tasks — replace full task state
  router.put('/:projectId/tasks', async (req, res) => {
    try {
      const { projectId } = req.params
      const { todos, groups, lastPriority, lastGroupId, groupSortOrders, groupFilterPriority } = req.body

      if (!Array.isArray(todos) || !Array.isArray(groups)) {
        res.status(400).json({ error: 'todos and groups must be arrays' })
        return
      }

      const data = await taskService.setTaskData(projectId, {
        todos,
        groups,
        lastPriority: lastPriority ?? 'medium',
        lastGroupId: lastGroupId ?? null,
        groupSortOrders: groupSortOrders ?? {},
        groupFilterPriority: groupFilterPriority ?? {},
      })
      res.json(data)
    } catch (error) {
      console.error('Failed to save task data:', error)
      res.status(500).json({ error: 'Failed to save task data' })
    }
  })

  // DELETE /api/projects/:projectId/tasks — delete all task data for a project
  router.delete('/:projectId/tasks', async (req, res) => {
    try {
      await taskService.deleteTaskData(req.params.projectId)
      res.status(204).end()
    } catch (error) {
      console.error('Failed to delete task data:', error)
      res.status(500).json({ error: 'Failed to delete task data' })
    }
  })

  return router
}