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

export interface CrashReport {
  shellId: string
  name: string
  command: string
  exitCode: number
  recentOutput: string
  timestamp: number
}

export function useManagedShells(projectId: string | null, onShellCrash?: (report: CrashReport) => void) {
  const [shells, setShells] = useState<Map<string, ManagedShellState>>(new Map())
  const [viewingShell, setViewingShell] = useState<string | null>(null)
  const shellsRef = useRef(shells)
  shellsRef.current = shells
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId
  const onShellCrashRef = useRef(onShellCrash)
  onShellCrashRef.current = onShellCrash

  // Fetch current shell list from REST API (also updates statuses)
  const fetchShells = useCallback(async () => {
    const pid = projectIdRef.current
    if (!pid) return
    try {
      const res = await fetch(`/api/managed-shells/${pid}`)
      if (!res.ok) return
      const data = await res.json()
      const list: ManagedShellInfo[] = data.shells || []
      setShells(prev => {
        let changed = false
        const next = new Map(prev)
        for (const s of list) {
          const existing = next.get(s.id)
          if (existing) {
            if (existing.status !== s.status || existing.exitCode !== s.exitCode) {
              next.set(s.id, { ...existing, status: s.status, exitCode: s.exitCode })
              changed = true
            }
          } else {
            next.set(s.id, { ...s, output: '' })
            changed = true
          }
        }
        const serverIds = new Set(list.map(s => s.id))
        for (const id of next.keys()) {
          if (!serverIds.has(id)) {
            next.delete(id)
            changed = true
          }
        }
        return changed ? next : prev
      })
    } catch {
      // Fetch failed silently
    }
  }, [])

  // Initial fetch + refetch on projectId change
  useEffect(() => {
    if (!projectId) return
    const timer = setTimeout(() => { fetchShells() }, 0)
    return () => clearTimeout(timer)
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Poll shell statuses + crash reports every 5 seconds when any shell exists
  useEffect(() => {
    const pid = projectIdRef.current
    if (!pid) return

    const hasAnyShells = () => shellsRef.current.size > 0
    if (!hasAnyShells()) return

    const interval = setInterval(async () => {
      if (!hasAnyShells()) return

      // Always poll shell statuses to detect crashes between AI turns
      fetchShells()

      // Also poll crash reports if callback provided
      if (onShellCrashRef.current) {
        try {
          const res = await fetch(`/api/managed-shells/${pid}/crash-reports`)
          if (!res.ok) return
          const data = await res.json()
          const reports: CrashReport[] = data.crashReports || []
          for (const report of reports) {
            onShellCrashRef.current?.(report)
          }
        } catch {
          // Poll failed silently
        }
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [projectId, shells, fetchShells, onShellCrash]) // eslint-disable-line react-hooks/exhaustive-deps

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
    const pid = projectIdRef.current
    if (!pid) return
    try {
      await fetch(`/api/managed-shells/${pid}/${shellId}`, { method: 'DELETE' })
      // Don't remove from Map here — ShellBlock falls back to stale msg.shells status
      // if the shell disappears from liveShells. The fetchShells poll will clean it up.
      setViewingShell(prev => prev === shellId ? null : prev)
    } catch {
      // Dismiss failed
    }
  }, [])

  const terminateShell = useCallback(async (shellId: string) => {
    const pid = projectIdRef.current
    if (!pid) return
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
      await fetch(`/api/managed-shells/${pid}/${shellId}/terminate`, { method: 'POST' })
    } catch {
      // Terminate failed — revert on error by fetching fresh state
      fetchShells()
    }
  }, [fetchShells])

  // Fetch full output from REST API for a specific shell (used by ManagedTerminalPanel directly)
  // NOTE: We do NOT replace shell.output here — the terminal panel fetches independently
  // and tracks its own writtenLenRef to avoid double-text from SSE overlap.
  const fetchShellOutput = useCallback(async (shellId: string) => {
    // No-op: terminal panel fetches output directly from the REST API.
    // Keeping this function for API compatibility but it does nothing,
    // since replacing shell.output here causes double-text in the terminal.
  }, [])

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