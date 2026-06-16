import { useState, useCallback, useRef, useEffect } from 'react'

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  modified?: string
}

export interface OpenFile {
  path: string
  content: string
  dirty: boolean
  binary?: boolean
  cursorPos?: { line: number; col: number }
  scrollPos?: number
}

interface WorkspaceState {
  openFilePaths: string[]
  dirtyContents: Record<string, string>
  activeFilePath: string | null
  expandedDirs: string[]
  explorerVisible: boolean
  terminalVisible: boolean
}

const STORAGE_KEY_PREFIX = 'workspace_state_'

function loadState(pid: string): WorkspaceState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_PREFIX + pid)
    if (!raw) return null
    return JSON.parse(raw) as WorkspaceState
  } catch {
    return null
  }
}

function saveState(pid: string, state: WorkspaceState) {
  try {
    sessionStorage.setItem(STORAGE_KEY_PREFIX + pid, JSON.stringify(state))
  } catch {
    sessionStorage.removeItem(STORAGE_KEY_PREFIX + pid)
  }
}

export function useWorkspace(projectId: string) {
  const saved = useRef(loadState(projectId))

  const [fileTree, setFileTree] = useState<Record<string, FileEntry[]>>({})
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => {
    const dirs = saved.current?.expandedDirs
    return dirs ? new Set(dirs) : new Set()
  })
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activeFilePath, setActiveFilePath] = useState<string | null>(() => saved.current?.activeFilePath ?? null)
  const [terminalVisible, setTerminalVisible] = useState(() => saved.current?.terminalVisible ?? false)
  const [explorerVisible, setExplorerVisible] = useState(() => saved.current?.explorerVisible ?? true)
  const [terminalSessions, setTerminalSessions] = useState<number[]>([])
  const [activeTerminalId, setActiveTerminalId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gitStatusMap, setGitStatusMap] = useState<Record<string, string>>({})
  const [gitBranch, setGitBranch] = useState<string | null>(null)
  const nextTerminalId = useRef(1)
  const openFilesRef = useRef(openFiles)
  openFilesRef.current = openFiles

  const activeFile = openFiles.find((f) => f.path === activeFilePath) ?? null

  // Fetch root directory and any previously expanded subdirectories on mount
  useEffect(() => {
    const init = async () => {
      await fetchDirectory('.')
      const savedDirs = saved.current?.expandedDirs
      if (savedDirs) {
        for (const dir of savedDirs) {
          if (dir !== '.') {
            fetchDirectory(dir)
          }
        }
      }
    }
    init()
  }, [])

  const fetchDirectory = useCallback(async (dirPath: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspace/${projectId}/files?path=${encodeURIComponent(dirPath)}`)
      if (!res.ok) throw new Error('Failed to list directory')
      const entries: FileEntry[] = await res.json()
      setFileTree((prev) => ({ ...prev, [dirPath]: entries }))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const fetchGitStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/${projectId}/git-status`)
      if (!res.ok) return
      setGitStatusMap(await res.json())
    } catch { /* non-critical */ }
  }, [projectId])

  const fetchGitBranch = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/${projectId}/git-branch`)
      if (res.ok) {
        const json = await res.json()
        setGitBranch(json.branch)
      }
    } catch { /* non-critical */ }
  }, [projectId])

  useEffect(() => {
    fetchGitStatus()
    fetchGitBranch()
  }, [fetchGitStatus, fetchGitBranch])

  const toggleDir = useCallback(async (dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(dirPath)) {
        next.delete(dirPath)
      } else {
        next.add(dirPath)
        fetchDirectory(dirPath)
      }
      return next
    })
  }, [fetchDirectory])

  const openFile = useCallback(async (filePath: string) => {
    const existing = openFiles.find((f) => f.path === filePath)
    if (existing) {
      setActiveFilePath(filePath)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspace/${projectId}/file?path=${encodeURIComponent(filePath)}`)
      if (!res.ok) throw new Error('Failed to read file')
      const data = await res.json()
      const newFile: OpenFile = {
        path: filePath,
        content: data.content || '',
        dirty: false,
        binary: data.binary || false,
      }
      setOpenFiles((prev) => [...prev, newFile])
      setActiveFilePath(filePath)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [projectId, openFiles])

  const closeFile = useCallback((filePath: string): boolean => {
    const file = openFilesRef.current.find((f) => f.path === filePath)
    if (file?.dirty) return false

    setOpenFiles((prev) => {
      const remaining = prev.filter((f) => f.path !== filePath)
      setActiveFilePath((prevActive) => {
        if (prevActive === filePath) {
          return remaining.length > 0 ? remaining[remaining.length - 1].path : null
        }
        return prevActive
      })
      return remaining
    })
    return true
  }, [])

  const forceCloseFile = useCallback((filePath: string) => {
    setOpenFiles((prev) => {
      const remaining = prev.filter((f) => f.path !== filePath)
      setActiveFilePath((prevActive) => {
        if (prevActive === filePath) {
          return remaining.length > 0 ? remaining[remaining.length - 1].path : null
        }
        return prevActive
      })
      return remaining
    })
  }, [])

  const updateFileContent = useCallback((filePath: string, content: string) => {
    setOpenFiles((prev) =>
      prev.map((f) => f.path === filePath ? { ...f, content, dirty: true } : f)
    )
  }, [])

  const saveFile = useCallback(async (filePath: string): Promise<boolean> => {
    const file = openFilesRef.current.find((f) => f.path === filePath)
    if (!file) return false

    try {
      const res = await fetch(`/api/workspace/${projectId}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: file.content }),
      })
      if (!res.ok) throw new Error('Failed to save file')

      setOpenFiles((prev) =>
        prev.map((f) => f.path === filePath ? { ...f, dirty: false } : f)
      )
      fetchGitStatus()
      return true
    } catch (err: any) {
      setError(err.message)
      return false
    }
  }, [projectId, fetchGitStatus])

  const createFile = useCallback(async (filePath: string, type: 'file' | 'directory') => {
    try {
      const res = await fetch(`/api/workspace/${projectId}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, type }),
      })
      if (!res.ok) throw new Error('Failed to create entry')
      const parentDir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '.'
      await fetchDirectory(parentDir)
      return true
    } catch (err: any) {
      setError(err.message)
      return false
    }
  }, [projectId, fetchDirectory])

  const deleteEntry = useCallback(async (filePath: string) => {
    try {
      const res = await fetch(`/api/workspace/${projectId}/file?path=${encodeURIComponent(filePath)}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete entry')
      const parentDir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '.'
      await fetchDirectory(parentDir)
      forceCloseFile(filePath)
      // If the deleted entry was a directory, also close any open files inside it
      setOpenFiles((prev) => prev.filter((f) => !f.path.startsWith(filePath + '/')))
      return true
    } catch (err: any) {
      setError(err.message)
      return false
    }
  }, [projectId, fetchDirectory, forceCloseFile])

  const renameEntry = useCallback(async (oldPath: string, newPath: string) => {
    try {
      const res = await fetch(`/api/workspace/${projectId}/file/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, newPath }),
      })
      if (!res.ok) throw new Error('Failed to move entry')
      const oldParentDir = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '.'
      const newParentDir = newPath.includes('/') ? newPath.substring(0, newPath.lastIndexOf('/')) : '.'
      await fetchDirectory(oldParentDir)
      if (newParentDir !== oldParentDir) {
        await fetchDirectory(newParentDir)
      }
      // Update any open files that were inside the renamed path
      setOpenFiles((prev) =>
        prev.map((f) => {
          if (f.path === oldPath) {
            return { ...f, path: newPath, dirty: true }
          }
          if (f.path.startsWith(oldPath + '/')) {
            return { ...f, path: newPath + f.path.substring(oldPath.length), dirty: true }
          }
          return f
        })
      )
      if (activeFilePath === oldPath) {
        setActiveFilePath(newPath)
      } else if (activeFilePath?.startsWith(oldPath + '/')) {
        setActiveFilePath(newPath + activeFilePath.substring(oldPath.length))
      }
      return true
    } catch (err: any) {
      setError(err.message)
      return false
    }
  }, [projectId, fetchDirectory, activeFilePath])

  const copyEntry = useCallback(async (srcPath: string, destDir: string) => {
    try {
      const res = await fetch(`/api/workspace/${projectId}/file/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ srcPath, destDir }),
      })
      if (!res.ok) throw new Error('Failed to copy')
      const srcParent = srcPath.includes('/') ? srcPath.substring(0, srcPath.lastIndexOf('/')) : '.'
      await fetchDirectory(srcParent)
      if (destDir !== srcParent) {
        await fetchDirectory(destDir)
      }
      fetchGitStatus()
      return true
    } catch (err: any) {
      setError(err.message)
      return false
    }
  }, [projectId, fetchDirectory, fetchGitStatus])

  const searchFiles = useCallback(async (query: string): Promise<FileEntry[]> => {
    if (!query.trim()) return []
    try {
      const res = await fetch(`/api/workspace/${projectId}/search?q=${encodeURIComponent(query)}`)
      if (!res.ok) return []
      return await res.json()
    } catch {
      return []
    }
  }, [projectId])

  const createTerminal = useCallback(() => {
    const id = nextTerminalId.current++
    setTerminalSessions((prev) => [...prev, id])
    setActiveTerminalId(id)
    setTerminalVisible(true)
  }, [])

  const closeTerminal = useCallback((id: number) => {
    setTerminalSessions((prev) => {
      const remaining = prev.filter((t) => t !== id)
      if (remaining.length === 0) {
        setTerminalVisible(false)
        setActiveTerminalId(null)
      } else {
        setActiveTerminalId(remaining[remaining.length - 1])
      }
      return remaining
    })
  }, [])

  const switchTab = useCallback((direction: 'next' | 'prev') => {
    if (openFiles.length <= 1) return
    const currentIndex = openFiles.findIndex((f) => f.path === activeFilePath)
    let next: number
    if (direction === 'next') {
      next = (currentIndex + 1) % openFiles.length
    } else {
      next = (currentIndex - 1 + openFiles.length) % openFiles.length
    }
    setActiveFilePath(openFiles[next].path)
  }, [openFiles, activeFilePath])

  // Warn before closing/refreshing when there are unsaved files
  useEffect(() => {
    const hasDirty = openFiles.some((f) => f.dirty)
    if (!hasDirty) return

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [openFiles])

  // Persist workspace state to sessionStorage (debounced)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      const dirtyContents: Record<string, string> = {}
      for (const f of openFiles) {
        if (f.dirty) dirtyContents[f.path] = f.content
      }
      saveState(projectId, {
        openFilePaths: openFiles.map((f) => f.path),
        dirtyContents,
        activeFilePath,
        expandedDirs: [...expandedDirs],
        explorerVisible,
        terminalVisible,
      })
    }, 300)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [openFiles, activeFilePath, expandedDirs, explorerVisible, terminalVisible, projectId])

  // Restore open files from sessionStorage on mount — re-fetch clean content from server
  const restoredRef = useRef(false)

  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true

    const state = saved.current
    if (!state?.openFilePaths?.length) return

    const dirtyContents = state.dirtyContents || {}
    const restore = async () => {
      const files: OpenFile[] = []
      for (const path of state.openFilePaths) {
        if (dirtyContents[path] !== undefined) {
          files.push({ path, content: dirtyContents[path], dirty: true })
        } else {
          try {
            const res = await fetch(`/api/workspace/${projectId}/file?path=${encodeURIComponent(path)}`)
            if (res.ok) {
              const data = await res.json()
              files.push({ path, content: data.content || '', dirty: false, binary: data.binary || false })
            }
          } catch {
            // skip files that fail to load
          }
        }
      }
      if (files.length > 0) {
        setOpenFiles(files)
        if (state.activeFilePath && files.some((f) => f.path === state.activeFilePath)) {
          setActiveFilePath(state.activeFilePath)
        } else if (files.length > 0) {
          setActiveFilePath(files[files.length - 1].path)
        }
      }
    }
    restore()
  }, [projectId])

  // Auto-expand directories to reveal the active file
  const fileTreeRef = useRef(fileTree)
  fileTreeRef.current = fileTree

  useEffect(() => {
    if (!activeFilePath) return
    const parts = activeFilePath.split('/')
    if (parts.length <= 1) return // file is in root, already visible

    const dirsToExpand: string[] = []
    for (let i = 1; i < parts.length; i++) {
      dirsToExpand.push(parts.slice(0, i).join('/'))
    }

    setExpandedDirs((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const dir of dirsToExpand) {
        if (!next.has(dir)) {
          next.add(dir)
          changed = true
        }
      }
      return changed ? next : prev
    })

    const currentTree = fileTreeRef.current
    for (const dir of dirsToExpand) {
      if (!currentTree[dir]) {
        fetchDirectory(dir)
      }
    }
  }, [activeFilePath, fetchDirectory])

  // Watch for filesystem changes via WebSocket and refresh expanded dirs
  const expandedDirsRef = useRef(expandedDirs)
  expandedDirsRef.current = expandedDirs

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/workspace/watch?projectId=${encodeURIComponent(projectId)}`)

    const pendingRefreshes = new Set<string>()
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'change' && msg.dirPath) {
          pendingRefreshes.add(msg.dirPath)
          if (!refreshTimer) {
            refreshTimer = setTimeout(() => {
              refreshTimer = null
              const current = expandedDirsRef.current
              for (const dir of pendingRefreshes) {
                if (dir === '.' || current.has(dir)) {
                  fetchDirectory(dir)
                }
                for (const expanded of current) {
                  if (expanded !== '.' && (dir.startsWith(expanded + '/') || dir === expanded)) {
                    fetchDirectory(expanded)
                  }
                }
              }
              pendingRefreshes.clear()
              fetchGitStatus()
            }, 400)
          }
        } else if (msg.type === 'file-change' && msg.filePath) {
          // Re-fetch content for non-dirty open files that were changed externally
          const open = openFilesRef.current
          for (const f of open) {
            if (f.path === msg.filePath && !f.dirty && !f.binary) {
              fetch(`/api/workspace/${projectId}/file?path=${encodeURIComponent(f.path)}`)
                .then(res => res.ok ? res.json() : null)
                .then(data => {
                  if (data?.content !== undefined) {
                    setOpenFiles(prev => prev.map(of =>
                      of.path === f.path ? { ...of, content: data.content } : of
                    ))
                  }
                })
                .catch(() => {})
            }
          }
        } else if (msg.type === 'git-status-change') {
          fetchGitStatus()
          fetchGitBranch()
        }
      } catch {}
    }

    return () => {
      ws.close()
      if (refreshTimer) clearTimeout(refreshTimer)
    }
  }, [projectId, fetchDirectory, fetchGitStatus, fetchGitBranch])

  return {
    fileTree,
    expandedDirs,
    openFiles,
    activeFilePath,
    activeFile,
    terminalVisible,
    explorerVisible,
    terminalSessions,
    activeTerminalId,
    loading,
    error,
    setError,
    fetchDirectory,
    toggleDir,
    openFile,
    closeFile,
    forceCloseFile,
    updateFileContent,
    saveFile,
    createFile,
    deleteEntry,
    renameEntry,
    copyEntry,
    searchFiles,
    gitStatusMap,
    fetchGitStatus,
    gitBranch,
    fetchGitBranch,
    createTerminal,
    closeTerminal,
    setActiveFilePath,
    setActiveTerminalId,
    setTerminalVisible,
    setExplorerVisible,
    switchTab,
  }
}