import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useWorkspace } from '../../hooks/useWorkspace'
import { useSettings } from '../../hooks/useSettings'
import { useTheme } from '../../hooks/useTheme'
import { getThemeInfo } from '../../utils/editorThemes'
import { FileExplorer } from '../../components/workspace/FileExplorer'
import { EditorTabs } from '../../components/workspace/EditorTabs'
import { CodeEditor } from '../../components/workspace/CodeEditor'
import { WelcomeTab } from '../../components/workspace/WelcomeTab'
import { TerminalPanel } from '../../components/workspace/TerminalPanel'
import { StatusBar } from '../../components/workspace/StatusBar'
import { PanelResizeHandle } from '../../components/workspace/PanelResizeHandle'
import { QuickOpen } from '../../components/workspace/QuickOpen'

interface WorkspacePageProps {
  projectId: string
  projectName: string
  workspacePath: string
  conversationId: string | null
  pendingFileOpen?: { path: string; startLine?: number } | null
  onFileOpened?: () => void
}

export function WorkspacePage({ projectId, projectName, workspacePath, pendingFileOpen, onFileOpened }: WorkspacePageProps) {
  const ws = useWorkspace(projectId)
  const { settings, updateSettings } = useSettings()
  const { theme } = useTheme()
  const themeInfo = useMemo(() => getThemeInfo(settings.codeEditorTheme), [settings.codeEditorTheme])
  const isLightMode = theme === 'light' || themeInfo.isLight
  const [explorerWidth, setExplorerWidth] = useState(250)
  const [terminalHeight, setTerminalHeight] = useState(200)
  const [showQuickOpen, setShowQuickOpen] = useState(false)

  // Handle file open requests from other tabs (e.g., Dependencies)
  useEffect(() => {
    if (pendingFileOpen && ws.openFile) {
      ws.openFile(pendingFileOpen.path).then(() => {
        onFileOpened?.()
      })
    }
  }, [pendingFileOpen])

  // Auto-save: save file after 1.5s of no edits when autoSave is enabled
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    if (!settings.autoSave || !ws.activeFile?.dirty) return
    autoSaveTimer.current = setTimeout(() => {
      if (ws.activeFilePath) ws.saveFile(ws.activeFilePath)
    }, 1500)
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current) }
  }, [ws.activeFile?.dirty, ws.activeFilePath, settings.autoSave])

  const handleExplorerResize = useCallback((delta: number) => {
    setExplorerWidth((prev) => Math.max(150, Math.min(500, prev + delta)))
  }, [])

  const handleTerminalResize = useCallback((delta: number) => {
    setTerminalHeight((prev) => Math.max(100, Math.min(500, prev - delta)))
  }, [])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey

    if (ctrl && e.key === 's') {
      e.preventDefault()
      if (ws.activeFilePath) ws.saveFile(ws.activeFilePath)
    } else if (ctrl && e.key === 'w') {
      e.preventDefault()
      if (ws.activeFilePath) ws.closeFile(ws.activeFilePath)
    } else if (ctrl && e.key === '`') {
      e.preventDefault()
      if (!ws.terminalVisible) {
        if (ws.terminalSessions.length > 0) {
          ws.setTerminalVisible(true)
        } else {
          ws.createTerminal()
        }
      } else {
        ws.setTerminalVisible(false)
      }
    } else if (ctrl && e.key === 'b') {
      e.preventDefault()
      ws.setExplorerVisible((prev) => !prev)
    } else if (ctrl && e.key === 'Tab') {
      e.preventDefault()
      ws.switchTab(e.shiftKey ? 'prev' : 'next')
    } else if (ctrl && e.key === 'p') {
      e.preventDefault()
      setShowQuickOpen(true)
    }
  }, [ws])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div
      className="workspace-ide"
      style={{
        '--workspace-bg': themeInfo.bg,
        '--workspace-sidebar': themeInfo.sidebar,
      } as React.CSSProperties}
    >
      <div className="workspace-ide__main">
        {ws.explorerVisible && (
          <>
            <div className="workspace-ide__explorer" style={{ width: explorerWidth }}>
              <FileExplorer
                projectId={projectId}
                fileTree={ws.fileTree}
                expandedDirs={ws.expandedDirs}
                activeFilePath={ws.activeFilePath}
                gitStatusMap={ws.gitStatusMap}
                onToggleDir={ws.toggleDir}
                onOpenFile={ws.openFile}
                onCreateFile={ws.createFile}
                onDeleteEntry={ws.deleteEntry}
                onRenameEntry={ws.renameEntry}
                onCopyEntry={ws.copyEntry}
                onMoveEntry={ws.renameEntry}
                onRefresh={ws.fetchDirectory}
                workspacePath={workspacePath}
              />
            </div>
            <PanelResizeHandle direction="horizontal" onResize={handleExplorerResize} />
          </>
        )}

        <div className="workspace-ide__editor-area">
          <EditorTabs
            openFiles={ws.openFiles}
            activeFilePath={ws.activeFilePath}
            gitStatusMap={ws.gitStatusMap}
            onSelectFile={ws.setActiveFilePath}
            onCloseFile={ws.closeFile}
            onSaveFile={ws.saveFile}
            onForceCloseFile={ws.forceCloseFile}
          />
          <div className="workspace-ide__editor-content">
            {ws.activeFile ? (
              <CodeEditor
                file={ws.activeFile}
                onChange={(content) => ws.updateFileContent(ws.activeFile!.path, content)}
                onSave={() => ws.saveFile(ws.activeFilePath!)}
                editorTheme={settings.codeEditorTheme}
                isLightMode={isLightMode}
              />
            ) : (
              <WelcomeTab projectName={projectName} />
            )}
          </div>
        </div>
      </div>

      {ws.terminalVisible && (
        <>
          <PanelResizeHandle direction="vertical" onResize={handleTerminalResize} />
          <div className="workspace-ide__terminal" style={{ height: terminalHeight }}>
            <TerminalPanel
              projectId={projectId}
              sessions={ws.terminalSessions}
              activeTerminalId={ws.activeTerminalId}
              onSelectTerminal={ws.setActiveTerminalId}
              onCreateTerminal={ws.createTerminal}
              onCloseTerminal={ws.closeTerminal}
              workspacePath={workspacePath}
              isLightMode={isLightMode}
            />
          </div>
        </>
      )}

      <StatusBar
        projectId={projectId}
        activeFile={ws.activeFile}
        workspacePath={workspacePath}
        editorTheme={settings.codeEditorTheme}
        autoSave={settings.autoSave}
        onAutoSaveChange={(enabled) => updateSettings({ autoSave: enabled })}
        onThemeChange={(theme) => updateSettings({ codeEditorTheme: theme })}
      />

      {showQuickOpen && (
        <QuickOpen
          projectId={projectId}
          searchFiles={ws.searchFiles}
          onOpenFile={ws.openFile}
          onClose={() => setShowQuickOpen(false)}
        />
      )}
    </div>
  )
}