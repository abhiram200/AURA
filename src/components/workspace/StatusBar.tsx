import { useState, useEffect, useRef } from 'react'
import type { OpenFile } from '../../hooks/useWorkspace'
import { EDITOR_THEMES, getThemeInfo, getFilteredThemes, getEffectiveThemeKey } from '../../utils/editorThemes'
import { useTheme } from '../../hooks/useTheme'

interface StatusBarProps {
  projectId: string
  activeFile: OpenFile | null
  workspacePath: string
  editorTheme: string
  autoSave: boolean
  onAutoSaveChange: (enabled: boolean) => void
  onThemeChange: (theme: string) => void
  onOpenGitTree?: () => void
  gitBranch?: string | null
}

function getLanguageLabel(path: string | null): string {
  if (!path) return ''
  if (path.endsWith('.tsx')) return 'TypeScript JSX'
  if (path.endsWith('.ts')) return 'TypeScript'
  if (path.endsWith('.jsx')) return 'JavaScript JSX'
  if (path.endsWith('.mjs')) return 'JavaScript (ESM)'
  if (path.endsWith('.cjs')) return 'JavaScript (CJS)'
  if (path.endsWith('.js')) return 'JavaScript'
  if (path.endsWith('.css')) return 'CSS'
  if (path.endsWith('.scss')) return 'SCSS'
  if (path.endsWith('.less')) return 'Less'
  if (path.endsWith('.html') || path.endsWith('.htm')) return 'HTML'
  if (path.endsWith('.json')) return 'JSON'
  if (path.endsWith('.md') || path.endsWith('.markdown')) return 'Markdown'
  if (path.endsWith('.py') || path.endsWith('.pyw')) return 'Python'
  if (path.endsWith('.c') || path.endsWith('.h')) return 'C'
  if (path.endsWith('.cpp') || path.endsWith('.cc') || path.endsWith('.cxx') || path.endsWith('.hpp') || path.endsWith('.hh')) return 'C++'
  if (path.endsWith('.java')) return 'Java'
  if (path.endsWith('.rs')) return 'Rust'
  if (path.endsWith('.go')) return 'Go'
  if (path.endsWith('.sql')) return 'SQL'
  if (path.endsWith('.xml') || path.endsWith('.svg') || path.endsWith('.xsl') || path.endsWith('.xslt') || path.endsWith('.xsd')) return 'XML'
  if (path.endsWith('.yml') || path.endsWith('.yaml')) return 'YAML'
  if (path.endsWith('.php') || path.endsWith('.phtml')) return 'PHP'
  if (path.endsWith('.sh') || path.endsWith('.bash') || path.endsWith('.zsh')) return 'Shell'
  return 'Plain Text'
}

export function StatusBar({ projectId, activeFile, workspacePath, editorTheme, autoSave, onAutoSaveChange, onThemeChange, onOpenGitTree, gitBranch }: StatusBarProps) {
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { theme: appTheme } = useTheme()
  const filteredThemes = getFilteredThemes(appTheme)
  const effectiveThemeKey = getEffectiveThemeKey(editorTheme, appTheme)

  // Auto-switch editor theme when app theme changes and current theme doesn't match
  useEffect(() => {
    if (effectiveThemeKey !== editorTheme) {
      onThemeChange(effectiveThemeKey)
    }
  }, [appTheme]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const currentTheme = getThemeInfo(effectiveThemeKey)

  return (
    <div className="status-bar">
      <div className="status-bar__left">
        {gitBranch && (
          <button
            className="status-bar__item status-bar__item--btn status-bar__item--git-branch"
            onClick={onOpenGitTree}
            title="View git tree"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            {gitBranch}
          </button>
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
              {filteredThemes.map((t) => (
                <button
                  key={t.key}
                  className={`status-bar__theme-option${t.key === effectiveThemeKey ? ' status-bar__theme-option--active' : ''}`}
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