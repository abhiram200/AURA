import { useState, useEffect, useRef } from 'react'
import type { OpenFile } from '../../hooks/useWorkspace'
import { EDITOR_THEMES, getThemeInfo } from '../../utils/editorThemes'

interface StatusBarProps {
  projectId: string
  activeFile: OpenFile | null
  workspacePath: string
  editorTheme: string
  autoSave: boolean
  onAutoSaveChange: (enabled: boolean) => void
  onThemeChange: (theme: string) => void
}

function getLanguageLabel(path: string | null): string {
  if (!path) return ''
  if (path.endsWith('.tsx')) return 'TypeScript JSX'
  if (path.endsWith('.ts')) return 'TypeScript'
  if (path.endsWith('.jsx')) return 'JavaScript JSX'
  if (path.endsWith('.js')) return 'JavaScript'
  if (path.endsWith('.css')) return 'CSS'
  if (path.endsWith('.scss')) return 'SCSS'
  if (path.endsWith('.html')) return 'HTML'
  if (path.endsWith('.json')) return 'JSON'
  if (path.endsWith('.md')) return 'Markdown'
  if (path.endsWith('.py')) return 'Python'
  if (path.endsWith('.sh')) return 'Shell'
  return 'Plain Text'
}

export function StatusBar({ projectId, activeFile, workspacePath, editorTheme, autoSave, onAutoSaveChange, onThemeChange }: StatusBarProps) {
  const [gitBranch, setGitBranch] = useState<string | null>(null)
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(`/api/workspace/${projectId}/git-branch`)
      .then((r) => r.json())
      .then((data) => setGitBranch(data.branch))
      .catch(() => {})
  }, [projectId])

  useEffect(() => {
    if (!themeMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setThemeMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [themeMenuOpen])

  const language = getLanguageLabel(activeFile?.path || null)
  const currentTheme = getThemeInfo(editorTheme)

  return (
    <div className="status-bar">
      <div className="status-bar__left">
        {gitBranch && (
          <span className="status-bar__item">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            {gitBranch}
          </span>
        )}
        <span className="status-bar__item status-bar__item--path">
          {workspacePath.split(/[\\/]/).pop()}
        </span>
      </div>
      <div className="status-bar__right">
        {language && (
          <span className="status-bar__item">{language}</span>
        )}
        <button
          className={`status-bar__item status-bar__item--btn${autoSave ? ' status-bar__autosave--active' : ''}`}
          onClick={() => onAutoSaveChange(!autoSave)}
        >
          Auto-Save{autoSave ? ': On' : ': Off'}
        </button>
        <span className="status-bar__item">UTF-8</span>
        <div className="status-bar__theme-picker" ref={menuRef}>
          <button
            className="status-bar__item status-bar__item--btn"
            onClick={() => setThemeMenuOpen(!themeMenuOpen)}
          >
            <span className="status-bar__theme-dot" style={{ background: currentTheme.bg }} />
            {currentTheme.label}
          </button>
          {themeMenuOpen && (
            <div className="status-bar__theme-menu">
              {EDITOR_THEMES.map((t) => (
                <button
                  key={t.key}
                  className={`status-bar__theme-option${t.key === editorTheme ? ' status-bar__theme-option--active' : ''}`}
                  onClick={() => { onThemeChange(t.key); setThemeMenuOpen(false) }}
                >
                  <span className="status-bar__theme-dot" style={{ background: t.bg }} />
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}