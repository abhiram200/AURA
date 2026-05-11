import { useState, useCallback, useRef, useEffect } from 'react'
import type { FileEntry } from '../../hooks/useWorkspace'
import { ConfirmModal } from './ConfirmModal'

interface FileExplorerProps {
  projectId: string
  fileTree: Record<string, FileEntry[]>
  expandedDirs: Set<string>
  activeFilePath: string | null
  gitStatusMap: Record<string, string>
  onToggleDir: (path: string) => void
  onOpenFile: (path: string) => void
  onCreateFile: (path: string, type: 'file' | 'directory') => Promise<boolean>
  onDeleteEntry: (path: string) => void
  onRenameEntry: (oldPath: string, newPath: string) => void
  onCopyEntry: (srcPath: string, destDir: string) => Promise<boolean>
  onMoveEntry: (oldPath: string, newPath: string) => Promise<boolean>
  onRefresh: (path: string) => void
  workspacePath: string
}

const GIT_STATUS_CONFIG: Record<string, { letter: string; color: string }> = {
  M: { letter: 'M', color: '#e2c08d' },
  A: { letter: 'A', color: '#73c991' },
  U: { letter: 'U', color: '#73c991' },
  D: { letter: 'D', color: '#c74e39' },
  R: { letter: 'R', color: '#e2c08d' },
}

const FILE_ICONS: Record<string, string> = {
  '.ts': 'TS', '.tsx': 'TSX', '.js': 'JS', '.jsx': 'JSX',
  '.css': 'CSS', '.scss': 'SCSS', '.less': 'LES', '.html': 'HTML', '.htm': 'HTM',
  '.json': '{}', '.md': 'MD', '.markdown': 'MD',
  '.py': 'PY', '.pyw': 'PYW',
  '.c': 'C', '.h': 'H', '.cpp': '++', '.cc': '++', '.cxx': '++', '.hpp': '++', '.hh': '++',
  '.java': 'JV', '.rs': 'RS', '.go': 'GO',
  '.sql': 'SQL', '.xml': 'XML', '.svg': 'SVG', '.xsl': 'XSL',
  '.yml': 'YML', '.yaml': 'YML',
  '.php': 'PHP', '.phtml': 'PHP',
  '.sh': 'SH', '.bash': 'SH', '.zsh': 'SH',
  '.gitignore': 'GI', '.env': 'ENV',
  '.png': 'IMG', '.jpg': 'IMG', '.jpeg': 'IMG', '.gif': 'IMG', '.ico': 'ICO',
  '.toml': 'TOM', '.ini': 'INI', '.cfg': 'CFG',
  '.lock': 'LK', '.log': 'LOG',
}

function getFileIcon(name: string): string {
  for (const [ext, icon] of Object.entries(FILE_ICONS)) {
    if (name.endsWith(ext)) return icon
  }
  return name.startsWith('.') ? name.substring(1, 3).toUpperCase() : 'F'
}

function getFileIconColor(name: string): string {
  if (name.endsWith('.ts') || name.endsWith('.tsx')) return '#3178c6'
  if (name.endsWith('.js') || name.endsWith('.jsx') || name.endsWith('.mjs') || name.endsWith('.cjs')) return '#f7df1e'
  if (name.endsWith('.css')) return '#1572b6'
  if (name.endsWith('.scss')) return '#c6538c'
  if (name.endsWith('.less')) return '#1d3d6f'
  if (name.endsWith('.html') || name.endsWith('.htm')) return '#e34c26'
  if (name.endsWith('.json')) return '#5b5b5b'
  if (name.endsWith('.md') || name.endsWith('.markdown')) return '#083fa1'
  if (name.endsWith('.py') || name.endsWith('.pyw')) return '#3572a5'
  if (name.endsWith('.c') || name.endsWith('.h')) return '#555555'
  if (name.endsWith('.cpp') || name.endsWith('.cc') || name.endsWith('.cxx') || name.endsWith('.hpp') || name.endsWith('.hh')) return '#f34b7d'
  if (name.endsWith('.java')) return '#b07219'
  if (name.endsWith('.rs')) return '#dea584'
  if (name.endsWith('.go')) return '#00add8'
  if (name.endsWith('.sql')) return '#e38c00'
  if (name.endsWith('.xml') || name.endsWith('.xsl') || name.endsWith('.xsd')) return '#0060ac'
  if (name.endsWith('.yml') || name.endsWith('.yaml')) return '#cb171e'
  if (name.endsWith('.php') || name.endsWith('.phtml')) return '#4f5d95'
  if (name.endsWith('.svg')) return '#ff9900'
  if (name.endsWith('.sh') || name.endsWith('.bash') || name.endsWith('.zsh')) return '#89e051'
  return 'var(--text-secondary)'
}

interface ClipboardState {
  type: 'copy' | 'cut'
  path: string
  name: string
}

function ContextMenu({
  x, y, onClose, actions,
}: {
  x: number
  y: number
  onClose: () => void
  actions: { label: string; action: () => void; danger?: boolean }[]
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div className="file-explorer__context-menu" ref={ref} style={{ left: x, top: y }}>
      {actions.map((a, i) => (
        <button
          key={i}
          className={`file-explorer__context-item${a.danger ? ' file-explorer__context-item--danger' : ''}`}
          onClick={() => { a.action(); onClose() }}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}

export function FileExplorer({
  fileTree, expandedDirs, activeFilePath, gitStatusMap,
  onToggleDir, onOpenFile, onCreateFile, onDeleteEntry, onRenameEntry, onCopyEntry, onMoveEntry, onRefresh, workspacePath,
}: FileExplorerProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string; type: 'file' | 'directory' } | null>(null)
  const [renaming, setRenaming] = useState<{ path: string; newName: string } | null>(null)
  const [creating, setCreating] = useState<{ parentDir: string; type: 'file' | 'directory'; name: string } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const [draggingPath, setDraggingPath] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedType, setSelectedType] = useState<'file' | 'directory' | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const createInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming && renameInputRef.current) renameInputRef.current.focus()
    if (creating && createInputRef.current) createInputRef.current.focus()
  }, [renaming, creating])

  // Keep selection in sync with active file (e.g., when switching tabs)
  useEffect(() => {
    if (activeFilePath) {
      setSelectedPath(activeFilePath)
      setSelectedType('file')
    }
  }, [activeFilePath])

  const handleContextMenu = useCallback((e: React.MouseEvent, path: string, type: 'file' | 'directory') => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, path, type })
  }, [])

  const handleRenameSubmit = useCallback(() => {
    if (!renaming) return
    const parentDir = renaming.path.includes('/') ? renaming.path.substring(0, renaming.path.lastIndexOf('/')) : '.'
    const newPath = parentDir === '.' ? renaming.newName : `${parentDir}/${renaming.newName}`
    if (renaming.newName && renaming.newName !== renaming.path.split('/').pop()) {
      onRenameEntry(renaming.path, newPath)
    }
    setRenaming(null)
  }, [renaming, onRenameEntry])

  const handleCreateSubmit = useCallback(async (openAfterCreate = false) => {
    if (!creating) return
    if (!creating.name.trim()) {
      setCreating(null) // cancel on empty name
      return
    }
    const fullPath = creating.parentDir === '.' ? creating.name.trim() : `${creating.parentDir}/${creating.name.trim()}`
    await onCreateFile(fullPath, creating.type)
    if (openAfterCreate && creating.type === 'file') {
      onOpenFile(fullPath)
    }
    setCreating(null)
  }, [creating, onCreateFile, onOpenFile])

  const handleNewFile = useCallback((parentDir: string = '.', type: 'file' | 'directory' = 'file') => {
    setCreating({ parentDir, type, name: '' })
  }, [])

  const startRename = useCallback((path: string) => {
    const name = path.split('/').pop() || path
    setRenaming({ path, newName: name })
  }, [])

  const handlePaste = useCallback(async (targetDir: string) => {
    if (!clipboard) return
    if (clipboard.type === 'copy') {
      await onCopyEntry(clipboard.path, targetDir)
    } else {
      const name = clipboard.name
      const newPath = targetDir === '.' ? name : `${targetDir}/${name}`
      if (clipboard.path !== newPath) {
        await onMoveEntry(clipboard.path, newPath)
      }
    }
    setClipboard(null)
  }, [clipboard, onCopyEntry, onMoveEntry])

  // Drag & drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, path: string, name: string) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ path, name }))
    e.dataTransfer.effectAllowed = 'move'
    setDraggingPath(path)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, dirPath: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move'
    setDragOverPath(dirPath)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOverPath(null)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent, targetDir: string) => {
    e.preventDefault()
    setDragOverPath(null)
    setDraggingPath(null)

    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'))
      if (!data.path || !data.name) return

      const targetPath = targetDir === '.' ? data.name : `${targetDir}/${data.name}`
      if (data.path === targetPath) return

      if (e.ctrlKey || e.metaKey) {
        await onCopyEntry(data.path, targetDir)
      } else {
        await onMoveEntry(data.path, targetPath)
      }
    } catch {}
  }, [onCopyEntry, onMoveEntry])

  const handleDragEnd = useCallback(() => {
    setDraggingPath(null)
    setDragOverPath(null)
  }, [])

  const rootEntries = fileTree['.'] || []

  const renderTree = (entries: FileEntry[], dirPath: string, depth: number = 0): React.ReactNode => {
    const items = entries.map((entry) => {
      const isExpanded = expandedDirs.has(entry.path)
      const isActive = entry.path === activeFilePath
      const displayName = entry.path.split('/').pop() || entry.path

      if (renaming?.path === entry.path) {
        return (
          <div key={entry.path} className="file-explorer__item" style={{ paddingLeft: depth * 16 + 8 }}>
            <input
              ref={renameInputRef}
              className="file-explorer__rename-input"
              value={renaming.newName}
              onChange={(e) => setRenaming({ ...renaming, newName: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') setRenaming(null) }}
              onBlur={handleRenameSubmit}
            />
          </div>
        )
      }

      return (
        <div key={entry.path}>
          <div
            className={`file-explorer__item${isActive ? ' file-explorer__item--active' : ''}${selectedPath === entry.path && !isActive ? ' file-explorer__item--selected' : ''}${dragOverPath === entry.path && entry.type === 'directory' ? ' file-explorer__item--drag-over' : ''}${draggingPath === entry.path ? ' file-explorer__item--dragging' : ''}`}
            style={{ paddingLeft: depth * 16 + 8 }}
            onClick={() => {
              setSelectedPath(entry.path)
              setSelectedType(entry.type)
              if (entry.type === 'directory') onToggleDir(entry.path)
              else onOpenFile(entry.path)
            }}
            onContextMenu={(e) => handleContextMenu(e, entry.path, entry.type)}
            draggable
            onDragStart={(e) => handleDragStart(e, entry.path, displayName)}
            onDragOver={entry.type === 'directory' ? (e) => handleDragOver(e, entry.path) : undefined}
            onDragLeave={entry.type === 'directory' ? handleDragLeave : undefined}
            onDrop={entry.type === 'directory' ? (e) => handleDrop(e, entry.path) : undefined}
            onDragEnd={handleDragEnd}
          >
            {entry.type === 'directory' ? (
              <span className={`file-explorer__chevron${isExpanded ? ' file-explorer__chevron--open' : ''}`}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M9 18l6-6-6-6" /></svg>
              </span>
            ) : (
              <span className="file-explorer__spacer" />
            )}
            {entry.type === 'directory' ? (
              <span className="file-explorer__dir-icon" style={{ color: 'var(--accent-primary)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
              </span>
            ) : (
              <span className="file-explorer__file-icon" style={{ color: getFileIconColor(displayName) }}>
                {getFileIcon(displayName)}
              </span>
            )}
            <span
              className="file-explorer__name"
              style={entry.type === 'file' && gitStatusMap[entry.path] && GIT_STATUS_CONFIG[gitStatusMap[entry.path]]
                ? { color: GIT_STATUS_CONFIG[gitStatusMap[entry.path]].color }
                : undefined}
            >
              {displayName}
            </span>
            {entry.type === 'file' && gitStatusMap[entry.path] && (() => {
              const status = gitStatusMap[entry.path]
              const config = GIT_STATUS_CONFIG[status]
              return config ? (
                <span className="file-explorer__git-status" style={{ color: config.color }}>
                  {config.letter}
                </span>
              ) : null
            })()}
          </div>
          {entry.type === 'directory' && isExpanded && fileTree[entry.path] && (
            <div className="file-explorer__children">
              {renderTree(fileTree[entry.path], entry.path, depth + 1)}
            </div>
          )}
        </div>
      )
    })

    // Render create-in-directory inline input if creating in this directory
    if (creating && creating.parentDir === dirPath) {
      items.push(
        <div key="__creating__" className="file-explorer__item" style={{ paddingLeft: depth * 16 + 8 }}>
          <span className="file-explorer__spacer" />
          <span className="file-explorer__file-icon" style={{ color: 'var(--accent-primary)' }}>
            {creating.type === 'directory' ? 'DIR' : 'NEW'}
          </span>
          <input
            ref={createInputRef}
            className="file-explorer__rename-input"
            value={creating.name}
            placeholder={creating.type === 'directory' ? 'folder name' : 'file name'}
            onChange={(e) => setCreating({ ...creating, name: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreateSubmit(true); if (e.key === 'Escape') setCreating(null) }}
            onBlur={() => handleCreateSubmit(false)}
          />
        </div>
      )
    }

    return items
  }

  const contextMenuActions = contextMenu ? [
    ...(contextMenu.type === 'directory' ? [
      { label: 'New File', action: () => handleNewFile(contextMenu.path, 'file') },
      { label: 'New Folder', action: () => handleNewFile(contextMenu.path, 'directory') },
    ] : []),
    { label: 'Rename', action: () => startRename(contextMenu.path) },
    { label: 'Copy', action: () => {
      const name = contextMenu.path.split('/').pop() || contextMenu.path
      setClipboard({ type: 'copy', path: contextMenu.path, name })
    }},
    { label: 'Cut', action: () => {
      const name = contextMenu.path.split('/').pop() || contextMenu.path
      setClipboard({ type: 'cut', path: contextMenu.path, name })
    }},
    ...(contextMenu.type === 'directory' && clipboard ? [
      { label: `Paste (${clipboard.type === 'copy' ? 'Copy' : 'Move'})`, action: () => handlePaste(contextMenu.path) },
    ] : []),
    { label: 'Delete', action: () => setPendingDelete(contextMenu.path), danger: true },
  ] : []

  // Keyboard shortcuts for copy/cut/paste/delete when explorer is focused
  const handleExplorerKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Don't intercept if user is typing in an input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

    const ctrl = e.ctrlKey || e.metaKey

    if (ctrl && e.key === 'c' && selectedPath) {
      e.preventDefault()
      const name = selectedPath.split('/').pop() || selectedPath
      setClipboard({ type: 'copy', path: selectedPath, name })
    } else if (ctrl && e.key === 'x' && selectedPath) {
      e.preventDefault()
      const name = selectedPath.split('/').pop() || selectedPath
      setClipboard({ type: 'cut', path: selectedPath, name })
    } else if (ctrl && e.key === 'v' && clipboard) {
      e.preventDefault()
      const targetDir = selectedType === 'directory' && selectedPath ? selectedPath
        : selectedPath ? (selectedPath.includes('/') ? selectedPath.substring(0, selectedPath.lastIndexOf('/')) : '.')
        : '.'
      handlePaste(targetDir)
    } else if (e.key === 'Delete' && selectedPath) {
      e.preventDefault()
      setPendingDelete(selectedPath)
    } else if (e.key === 'F2' && selectedPath) {
      e.preventDefault()
      startRename(selectedPath)
    }
  }, [selectedPath, selectedType, clipboard, handlePaste, startRename])

  // Determine target directory for header buttons — falls back to activeFilePath when nothing selected in explorer
  const getCreateDir = useCallback((): string => {
    const effectivePath = selectedPath || activeFilePath
    if (!effectivePath) return '.'
    const isDir = selectedPath ? selectedType === 'directory' : false
    if (isDir) return effectivePath
    return effectivePath.includes('/') ? effectivePath.substring(0, effectivePath.lastIndexOf('/')) : '.'
  }, [selectedPath, selectedType, activeFilePath])

  return (
    <div className="file-explorer" tabIndex={-1}
      onKeyDown={handleExplorerKeyDown}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move' }}
      onDrop={(e) => handleDrop(e, '.')}
    >
      <div className="file-explorer__header">
        <span className="file-explorer__title">EXPLORER</span>
        <div className="file-explorer__actions">
          <button className="file-explorer__action-btn" onClick={() => handleNewFile(getCreateDir(), 'file')} title="New File">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" /></svg>
          </button>
          <button className="file-explorer__action-btn" onClick={() => handleNewFile(getCreateDir(), 'directory')} title="New Folder">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" /></svg>
          </button>
          <button className="file-explorer__action-btn" onClick={() => onRefresh('.')} title="Refresh">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
          </button>
        </div>
      </div>
      <div className="file-explorer__workspace-name">{workspacePath.split(/[\\/]/).pop()}</div>
      <div className="file-explorer__tree" onClick={(e) => { if (e.target === e.currentTarget) { setSelectedPath(null); setSelectedType(null) } }}>
        {renderTree(rootEntries, '.', 0)}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          actions={contextMenuActions}
        />
      )}

      <ConfirmModal
        open={pendingDelete !== null}
        title="Delete"
        message={`Delete "${pendingDelete}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (pendingDelete) onDeleteEntry(pendingDelete)
          setPendingDelete(null)
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}