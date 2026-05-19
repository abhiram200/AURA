import { useState, useEffect, useCallback, useRef } from 'react'

export type ManagedShellStatus = 'running' | 'completed' | 'failed' | 'killed'

export interface ManagedShellInfo {
  id: string
  name: string
  command: string
  status: ManagedShellStatus
  exitCode: number | null
  createdAt: number
}

export interface ManagedShellState extends ManagedShellInfo {
  output: string
}

export function useManagedShells(projectId: string | null) {
  const [shells, setShells] = useState<Map<string, ManagedShellState>>(new Map())
  const [viewingShell, setViewingShell] = useState<string | null>(null)
  const shellsRef = useRef(shells)
  shellsRef.current = shells

  // Fetch current shell list from REST API
  const fetchShells = useCallback(async () => {
    if (!projectId) return
    try {
      const res = await fetch(`/api/managed-shells/${projectId}`)
      if (!res.ok) return
      const data = await res.json()
      const list: ManagedShellInfo[] = data.shells || []
      setShells(prev => {
        const next = new Map(prev)
        for (const s of list) {
          const existing = next.get(s.id)
          if (existing) {
            if (existing.status !== s.status || existing.exitCode !== s.exitCode) {
              next.set(s.id, { ...existing, status: s.status, exitCode: s.exitCode })
            }
          } else {
            next.set(s.id, { ...s, output: '' })
          }
        }
        const serverIds = new Set(list.map(s => s.id))
        for (const id of next.keys()) {
          if (!serverIds.has(id)) next.delete(id)
        }
        return next
      })
    } catch {
      // Fetch failed silently
    }
  }, [projectId])

  useEffect(() => {
    fetchShells()
  }, [fetchShells])

  // Handle SSE shell events (called from useAura's SSE parser)
  const handleShellEvent = useCallback((eventType: string, data: Record<string, unknown>) => {
    if (eventType === 'shell_spawned') {
      setShells(prev => {
        const next = new Map(prev)
        next.set(data.shellId as string, {
          id: data.shellId as string,
          name: data.name as string,
          command: data.command as string,
          status: 'running',
          exitCode: null,
          createdAt: Date.now(),
          output: '',
        })
        return next
      })
    } else if (eventType === 'shell_output') {
      setShells(prev => {
        const next = new Map(prev)
        const shell = next.get(data.shellId as string)
        if (shell) {
          let output = shell.output + (data.data as string)
          if (output.length > 1024 * 1024) {
            output = output.slice(output.length - 1024 * 1024)
          }
          next.set(data.shellId as string, { ...shell, output })
        }
        return next
      })
    } else if (eventType === 'shell_exited') {
      setShells(prev => {
        const next = new Map(prev)
        const shell = next.get(data.shellId as string)
        if (shell) {
          const exitCode = data.exitCode as number
          let status: ManagedShellStatus
          if (exitCode === 0) status = 'completed'
          else if (exitCode === -1) status = 'killed'
          else status = 'failed'
          next.set(data.shellId as string, { ...shell, status, exitCode })
        }
        return next
      })
    } else if (eventType === 'shell_terminated') {
      setShells(prev => {
        const next = new Map(prev)
        const shell = next.get(data.shellId as string)
        if (shell) {
          next.set(data.shellId as string, { ...shell, status: 'killed', exitCode: -1 })
        }
        return next
      })
    }
  }, [])

  const dismissShell = useCallback(async (shellId: string) => {
    if (!projectId) return
    try {
      await fetch(`/api/managed-shells/${projectId}/${shellId}`, { method: 'DELETE' })
      setShells(prev => {
        const next = new Map(prev)
        next.delete(shellId)
        return next
      })
      if (viewingShell === shellId) setViewingShell(null)
    } catch {
      // Dismiss failed
    }
  }, [projectId, viewingShell])

  const terminateShell = useCallback(async (shellId: string) => {
    if (!projectId) return
    // Optimistically update UI state
    setShells(prev => {
      const next = new Map(prev)
      const shell = next.get(shellId)
      if (shell) {
        next.set(shellId, { ...shell, status: 'killed', exitCode: -1 })
      }
      return next
    })
    try {
      await fetch(`/api/managed-shells/${projectId}/${shellId}/terminate`, { method: 'POST' })
    } catch {
      // Terminate failed — revert on error by fetching fresh state
      fetchShells()
    }
  }, [projectId, fetchShells])

  // Fetch full output from REST API for a specific shell (used when opening terminal)
  const fetchShellOutput = useCallback(async (shellId: string) => {
    if (!projectId) return
    try {
      const res = await fetch(`/api/managed-shells/${projectId}/${shellId}/output`)
      if (!res.ok) return
      const data = await res.json()
      if (data.recentOutput) {
        setShells(prev => {
          const next = new Map(prev)
          const shell = next.get(shellId)
          if (shell) {
            next.set(shellId, { ...shell, output: data.recentOutput })
          }
          return next
        })
      }
    } catch {
      // Fetch failed silently
    }
  }, [projectId])

  const closeShellPanel = useCallback(() => {
    setViewingShell(null)
  }, [])

  const activeShells = [...shells.values()].filter(s => s.status === 'running')
  const allShells = [...shells.values()]

  return {
    shells,
    activeShells,
    allShells,
    viewingShell,
    setViewingShell,
    handleShellEvent,
    dismissShell,
    terminateShell,
    fetchShellOutput,
    closeShellPanel,
    fetchShells,
  }
}