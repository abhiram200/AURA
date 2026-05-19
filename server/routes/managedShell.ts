import { Router, type Request, type Response } from 'express'
import type { ManagedShellService } from '../services/managedShell.ts'

export function createManagedShellRouter(managedShellService: ManagedShellService): Router {
  const router = Router()

  // List all managed shells for a project
  router.get('/:projectId', (req: Request, res: Response) => {
    const projectId = req.params.projectId as string
    const shells = managedShellService.listShells(projectId)
    res.json({ shells })
  })

  // Get shell output
  router.get('/:projectId/:shellId/output', (req: Request, res: Response) => {
    const shellId = req.params.shellId as string
    const rawTail = req.query.tailLines
    const tailLines = rawTail ? parseInt(typeof rawTail === 'string' ? rawTail : String(rawTail), 10) : undefined
    const result = managedShellService.readOutput(shellId, tailLines)
    if (!result) {
      res.status(404).json({ error: 'Shell not found' })
      return
    }
    res.json(result)
  })

  // Terminate a shell
  router.post('/:projectId/:shellId/terminate', (req: Request, res: Response) => {
    const shellId = req.params.shellId as string
    const success = managedShellService.terminate(shellId)
    res.json({ success })
  })

  // Dismiss (remove) a completed/failed shell
  router.delete('/:projectId/:shellId', (req: Request, res: Response) => {
    const shellId = req.params.shellId as string
    const success = managedShellService.dismissShell(shellId)
    res.json({ success })
  })

  return router
}