import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useProjectMode, type Project } from '../hooks/useProjectMode'
import { useAnimationConfig, getTransition } from '../hooks/useAnimationConfig'
import { DeleteProjectModal } from '../components/shared/DeleteProjectModal'
import { SettingsPanel } from '../components/settings/SettingsPanel'
import { ThemeToggle } from '../components/shared/ThemeToggle'
import { useSettings } from '../hooks/useSettings'

// ── Project card with glow border ──────────────────────────────────────────

function ProjectCard({ project, onClick, onDelete, index }: { project: Project; onClick: () => void; onDelete: (e: React.MouseEvent) => void; index: number }) {
  const { animationIntensity } = useAnimationConfig()
  const statusColor = project.status === 'active' ? 'var(--accent-primary)' : 'var(--text-tertiary)'
  const statusLabel = project.status === 'active' ? 'Active' : 'Completed'
  const timeAgo = getTimeAgo(project.updatedAt)

  return (
    <motion.div
      className="pm-card"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick() }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={getTransition({ duration: 0.3, delay: index * 0.05 }, animationIntensity)}
    >
      <div className="pm-card__glow" />
      <button className="pm-card__delete" onClick={onDelete} title="Delete project">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <div className="pm-card__header">
        <span className="pm-card__status-dot" style={{ background: statusColor, boxShadow: `0 0 6px ${statusColor}` }} />
        <span className="pm-card__name">{project.name}</span>
      </div>
      {project.description && <p className="pm-card__desc">{project.description}</p>}
      <div className="pm-card__footer">
        <span className="pm-card__status" style={{ color: statusColor }}>{statusLabel}</span>
        <span className="pm-card__time">{timeAgo}</span>
      </div>
    </motion.div>
  )
}

// ── New project command input ──────────────────────────────────────────────

function NewProjectInput({ onSubmit, isCreating }: { onSubmit: (input: string) => void; isCreating: boolean }) {
  const { animationIntensity } = useAnimationConfig()
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const { settings } = useSettings()

  const cleanPath = (p: string) => p.replace(/^["'](.+)["']$/, '$1').trim()
  const isPathLike = (input: string) => /[\\/]/.test(input) || /^[A-Za-z]:/.test(input)
  const isGithubUrl = (input: string) => /^https?:\/\/github\.com\/.+\/.+/.test(input) || /^github\.com\/.+\/.+/.test(input)
  const trimmed = cleanPath(value)

  let hint = ''
  let hintType: 'info' | 'warning' = 'info'
  if (trimmed) {
    if (isGithubUrl(trimmed)) {
      hint = settings.defaultProjectPath
        ? `Clone into ${settings.defaultProjectPath.replace(/[/\\]+$/, '')}`
        : 'Set a default project path in Settings first'
      hintType = settings.defaultProjectPath ? 'info' : 'warning'
    } else if (isPathLike(trimmed)) {
      hint = 'Open or create at this path'
      hintType = 'info'
    } else if (settings.defaultProjectPath) {
      hint = `→ ${settings.defaultProjectPath.replace(/[/\\]+$/, '')}${settings.defaultProjectPath.includes('\\') ? '\\' : '/'}${trimmed}`
      hintType = 'info'
    } else {
      hint = 'Set a default path in Settings, or enter a full path'
      hintType = 'warning'
    }
  }

  return (
    <motion.div
      className="pm-command"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={getTransition(0.3, animationIntensity)}
    >
      <div className="pm-command__prompt">
        <span className="pm-command__arrow">❯</span>
        <input
          ref={inputRef}
          className="pm-command__input"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && trimmed && !isCreating) onSubmit(trimmed)
          }}
          placeholder="project-name, C:\path\to\project, or github.com/user/repo"
          disabled={isCreating}
          autoFocus
        />
        {isCreating && <span className="pm-command__spinner" />}
      </div>
      {hint && <div className={`pm-command__hint pm-command__hint--${hintType}`}>{hint}</div>}
    </motion.div>
  )
}

// ── Time formatting ─────────────────────────────────────────────────────────

function getTimeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

// ── Main page ───────────────────────────────────────────────────────────────

export function ProjectModePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { projects, loading, view, setView, setupStep, setSetupStep, startNewProject, createProject, autoCreateProject, cloneGithub, deleteProject } = useProjectMode()
  const { settings, models, updateSettings } = useSettings()
  const { animationIntensity } = useAnimationConfig()
  const hasAutoStarted = useRef(false)
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  useEffect(() => {
    const state = location.state as { tab?: string } | null
    if (state?.tab === 'new-project' && !hasAutoStarted.current) {
      hasAutoStarted.current = true
      startNewProject()
    }
  }, [location.state, startNewProject])

  const handleSelectProject = (projectId: string) => {
    navigate(`/project-mode/${projectId}`)
  }

  const isPathLike = (input: string) => /[\\/]/.test(input) || /^[A-Za-z]:/.test(input)
  const isGithubUrl = (input: string) => /^https?:\/\/github\.com\/.+\/.+/.test(input) || /^github\.com\/.+\/.+/.test(input)

  const handlePathSelected = async (input: string) => {
    setIsCreating(true)
    try {
      if (isGithubUrl(input)) {
        if (!settings.defaultProjectPath) {
          alert('No default project path set. Please set a default project path in Settings first.')
          return
        }
        try {
          const project = await cloneGithub(input)
          if (project) {
            navigate(`/project-mode/${project.id}`, { state: { workspacePath: project.workspacePath } })
          }
        } catch (err: any) {
          alert(err.message || 'Failed to clone repository')
        }
      } else if (isPathLike(input)) {
        const projectName = input.split(/[\\/]/).pop() || input
        const project = await createProject(projectName, '', input)
        if (project) {
          navigate(`/project-mode/${project.id}`, { state: { workspacePath: input } })
        }
      } else {
        if (!settings.defaultProjectPath) {
          const project = await createProject(input, '', input)
          if (project) {
            navigate(`/project-mode/${project.id}`, { state: { workspacePath: input } })
          }
          return
        }
        const sep = settings.defaultProjectPath.includes('\\') ? '\\' : '/'
        const workspacePath = settings.defaultProjectPath.replace(/[/\\]+$/, '') + sep + input
        const project = await autoCreateProject(input, '', workspacePath)
        if (project) {
          navigate(`/project-mode/${project.id}`, { state: { workspacePath } })
        }
      }
    } finally {
      setIsCreating(false)
    }
  }

  const handleDeleteEverywhere = async () => {
    if (!projectToDelete) return
    await deleteProject(projectToDelete.id, true)
    setProjectToDelete(null)
  }

  const handleDeleteFromBuilder = async () => {
    if (!projectToDelete) return
    await deleteProject(projectToDelete.id, false)
    setProjectToDelete(null)
  }

  const stagger = (i: number) => getTransition({ duration: 0.35, delay: i * 0.04 }, animationIntensity)

  return (
    <div className="pm">
      {/* ── Hero ── */}
      <header className="pm-hero">
        <motion.div
          className="pm-hero__brand"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={getTransition(0.5, animationIntensity)}
        >
          <h1 className="pm-hero__title">
            <span className="pm-hero__glow">A.U.R.A.</span>
          </h1>
          <p className="pm-hero__sub">Artificial Unified Responsive Assistant</p>
        </motion.div>

        <motion.div
          className="pm-hero__actions"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={getTransition(0.6, animationIntensity)}
        >
          <button
            className={`pm-tab${view === 'my-projects' ? ' pm-tab--active' : ''}`}
            onClick={() => setView('my-projects')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
            Projects
          </button>
          <button
            className={`pm-tab${view === 'new-project' ? ' pm-tab--active' : ''}`}
            onClick={startNewProject}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            New
          </button>
          <button
            className={`pm-tab${view === 'settings' ? ' pm-tab--active' : ''}`}
            onClick={() => setView('settings')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
            Settings
          </button>
          <ThemeToggle className="theme-toggle--inline" />
        </motion.div>
      </header>

      {/* ── Content ── */}
      <main className="pm-content">
        <AnimatePresence mode="wait">
          {view === 'my-projects' && (
            loading ? (
              <motion.div key="loading" className="pm-loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={getTransition(0.2, animationIntensity)}>
                <div className="pm-loading__spinner" />
                <div className="pm-loading__text">Scanning projects…</div>
              </motion.div>
            ) : projects.length === 0 ? (
              <motion.div key="empty" className="pm-empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={stagger(0)}>
                <div className="pm-empty__icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.4"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                </div>
                <div className="pm-empty__title">No projects yet</div>
                <div className="pm-empty__desc">Create your first project to get started with AURA.</div>
                <button className="pm-empty__btn" onClick={startNewProject}>New Project</button>
              </motion.div>
            ) : (
              <motion.div key="grid" className="pm-grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={getTransition(0.2, animationIntensity)}>
                {projects.map((project, i) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    index={i}
                    onClick={() => handleSelectProject(project.id)}
                    onDelete={(e) => { e.stopPropagation(); setProjectToDelete(project) }}
                  />
                ))}
              </motion.div>
            )
          )}

          {view === 'new-project' && (
            <motion.div key="new" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={getTransition(0.3, animationIntensity)}>
              <NewProjectInput onSubmit={handlePathSelected} isCreating={isCreating} />
            </motion.div>
          )}

          {view === 'settings' && (
            <motion.div key="settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={getTransition(0.3, animationIntensity)}>
              <SettingsPanel
                settings={settings}
                models={models}
                onSettingsChange={updateSettings}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <DeleteProjectModal
        open={projectToDelete !== null}
        project={projectToDelete}
        onDeleteEverywhere={handleDeleteEverywhere}
        onDeleteFromBuilder={handleDeleteFromBuilder}
        onCancel={() => setProjectToDelete(null)}
      />
    </div>
  )
}