import { useRef, useEffect, useState } from 'react'
import type { OpenFile } from '../../hooks/useWorkspace'
import { ConfirmModal } from './ConfirmModal'

interface EditorTabsProps {
  openFiles: OpenFile[]
  activeFilePath: string | null
  gitStatusMap: Record<string, string>
  onSelectFile: (path: string) => void
  onCloseFile: (path: string) => boolean
  onSaveFile: (path: string) => Promise<boolean>
  onForceCloseFile: (path: string) => void
}

const GIT_STATUS_CONFIG: Record<string, { letter: string; color: string }> = {
  M: { letter: 'M', color: '#e2c08d' },
  A: { letter: 'A', color: '#73c991' },
  U: { letter: 'U', color: '#73c991' },
  D: { letter: 'D', color: '#c74e39' },
  R: { letter: 'R', color: '#e2c08d' },
}

export function EditorTabs({
  openFiles, activeFilePath, gitStatusMap, onSelectFile, onCloseFile, onForceCloseFile,
}: EditorTabsProps) {
  const tabsRef = useRef<HTMLDivElement>(null)
  const [dirtyConfirm, setDirtyConfirm] = useState<string | null>(null)

  useEffect(() => {
    if (!tabsRef.current || !activeFilePath) return
    const activeTab = tabsRef.current.querySelector(`[data-path="${CSS.escape(activeFilePath)}"]`) as HTMLElement
    if (activeTab) activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [activeFilePath])

  const handleClose = (e: React.MouseEvent, filePath: string) => {
    e.stopPropagation()
    const closed = onCloseFile(filePath)
    if (!closed) {
      setDirtyConfirm(filePath)
    }
  }

  const getFileName = (path: string) => path.split('/').pop() || path

  if (openFiles.length === 0) return null

  return (
    <>
      <div className="editor-tabs" ref={tabsRef}>
        {openFiles.map((file) => {
          const isActive = file.path === activeFilePath
          return (
            <div
              key={file.path}
              data-path={file.path}
              className={`editor-tab${isActive ? ' editor-tab--active' : ''}`}
              onClick={() => onSelectFile(file.path)}
              onAuxClick={(e) => { if (e.button === 1) handleClose(e, file.path) }}
            >
              <span
                className="editor-tab__name"
                style={gitStatusMap[file.path] && GIT_STATUS_CONFIG[gitStatusMap[file.path]]
                  ? { color: GIT_STATUS_CONFIG[gitStatusMap[file.path]].color }
                  : undefined}
              >
                {getFileName(file.path)}
              </span>
              {gitStatusMap[file.path] && GIT_STATUS_CONFIG[gitStatusMap[file.path]] && (
                <span
                  className="editor-tab__git-status"
                  style={{ color: GIT_STATUS_CONFIG[gitStatusMap[file.path]].color }}
                >
                  {GIT_STATUS_CONFIG[gitStatusMap[file.path]].letter}
                </span>
              )}
              {file.dirty && <span className="editor-tab__dot" />}
              <button
                className="editor-tab__close"
                onClick={(e) => handleClose(e, file.path)}
                title="Close"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )
        })}
      </div>

      <ConfirmModal
        open={dirtyConfirm !== null}
        title="Unsaved Changes"
        message={`"${dirtyConfirm}" has unsaved changes. Discard them?`}
        confirmLabel="Discard"
        danger
        onConfirm={() => {
          if (dirtyConfirm) onForceCloseFile(dirtyConfirm)
          setDirtyConfirm(null)
        }}
        onCancel={() => setDirtyConfirm(null)}
      />
    </>
  )
}