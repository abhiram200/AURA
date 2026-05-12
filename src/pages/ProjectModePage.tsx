import { useState, useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useProjectMode, type Project } from '../hooks/useProjectMode'
import { useAnimationConfig, getTransition } from '../hooks/useAnimationConfig'
import { DeleteProjectModal } from '../components/chat/DeleteProjectModal'
import { useSettings } from '../hooks/useSettings'

function ProjectCard({ project, onClick, onDelete }: { project: Project; onClick: () => void; onDelete: (e: React.MouseEvent) => void }) {
  const statusColor = project.status === 'active' ? 'var(--accent-primary)' : 'var(--text-tertiary)'
  const statusLabel = project.status === 'active' ? 'Active' : 'Completed'

  return (
    <div className="project-card" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick() }}>
      <button className="project-card__delete" onClick={onDelete} title="Delete project">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <div className="project-card__name">{project.name}</div>
      <div className="project-card__description">{project.description}</div>
      <div className="project-card__footer">
        <span className="project-card__status" style={{ color: statusColor }}>
          {statusLabel}
        </span>
        <span className="project-card__date">{new Date(project.createdAt).toLocaleDateString()}</span>
      </div>
    </div>
  )
}

function FolderPicker({ onPathSelected, isCreating }: { onPathSelected: (path: string) => void; isCreating: boolean }) {
  const [folderPath, setFolderPath] = useState('')
  const { settings } = useSettings()

  const cleanPath = (p: string) => p.replace(/^["'](.+)["']$/, '$1').trim()
  const isPathLike = (input: string) => /[\\/]/.test(input) || /^[A-Za-z]:/.test(input)
  const isGithubUrl = (input: string) => /^https?:\/\/github\.com\/.+\/.+/.test(input) || /^github\.com\/.+\/.+/.test(input)

  return (
    <div className="folder-picker">
      <div className="folder-picker__icon">&#128193;</div>
      <div className="folder-picker__title">Create a new project</div>
      <div className="folder-picker__subtitle">
        Enter a project name, a full local path, or a GitHub URL to clone.
      </div>
      <div className="folder-picker__input-group">
        <input
          className="folder-picker__input"
          type="text"
          value={folderPath}
          onChange={(e) => setFolderPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && folderPath.trim() !== '' && !isCreating) {
              onPathSelected(cleanPath(folderPath))
            }
          }}
          placeholder="my-project, C:\Projects\my-project, or github.com/user/repo"
        />
      </div>
      {folderPath.trim() && isGithubUrl(cleanPath(folderPath)) && settings.defaultProjectPath && (
        <div className="folder-picker__hint">
          GitHub repo will be cloned into your default project path
        </div>
      )}
      {folderPath.trim() && isGithubUrl(cleanPath(folderPath)) && !settings.defaultProjectPath && (
        <div className="folder-picker__hint folder-picker__hint--warning">
          No default project path set. Set a default path in Settings first, or enter a full local path instead.
        </div>
      )}
      {folderPath.trim() && !isGithubUrl(cleanPath(folderPath)) && !isPathLike(cleanPath(folderPath)) && settings.defaultProjectPath && (
        <div className="folder-picker__hint">
          Will be created at: {settings.defaultProjectPath.replace(/[/\\]+$/, '') + (settings.defaultProjectPath.includes('\\') ? '\\' : '/') + cleanPath(folderPath)}
        </div>
      )}
      {folderPath.trim() && !isGithubUrl(cleanPath(folderPath)) && !isPathLike(cleanPath(folderPath)) && !settings.defaultProjectPath && (
        <div className="folder-picker__hint folder-picker__hint--warning">
          No default project path set. Enter a full path or set a default path in Settings.
        </div>
      )}
      <div className="folder-picker__actions">
        <button
          className="folder-picker__continue"
          disabled={folderPath.trim() === '' || isCreating}
          onClick={() => onPathSelected(cleanPath(folderPath))}
        >
          {isCreating ? 'Creating...' : 'Continue'}
        </button>
      </div>
    </div>
  )
}

export function ProjectModePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { projects, loading, view, setView, setupStep, setSetupStep, startNewProject, createProject, autoCreateProject, cloneGithub, deleteProject } = useProjectMode()
  const { settings } = useSettings()
  const { animationIntensity } = useAnimationConfig()
  const hasAutoStarted = useRef(false)
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  const conversationId = (location.state as { conversationId?: string | null } | null)?.conversationId ?? null
  const chatPath = conversationId ? `/chat/${conversationId}` : '/'

  useEffect(() => {
    const state = location.state as { tab?: string } | null
    if (state?.tab === 'new-project' && !hasAutoStarted.current) {
      hasAutoStarted.current = true
      startNewProject()
    }
  }, [location.state, startNewProject])

  const handleSelectProject = (projectId: string) => {
    navigate(`/project-mode/${projectId}`, { state: { conversationId } })
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
            if (conversationId) {
              fetch(`/api/conversations/${conversationId}/project`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: project.id }),
              }).catch(() => {})
            }
            navigate(`/project-mode/${project.id}`, { state: { workspacePath: project.workspacePath, conversationId } })
          }
        } catch (err: any) {
          alert(err.message || 'Failed to clone repository')
        }
      } else if (isPathLike(input)) {
        // Full path — add existing directory or create at that path
        const projectName = input.split(/[\\/]/).pop() || input
        const project = await createProject(projectName, '', input)
        if (project) {
          navigate(`/project-mode/${project.id}`, { state: { workspacePath: input, conversationId } })
        }
      } else {
        // Just a name — create in default project path
        if (!settings.defaultProjectPath) {
          // No default path — treat as a relative path (won't work well, but fallback)
          const project = await createProject(input, '', input)
          if (project) {
            navigate(`/project-mode/${project.id}`, { state: { workspacePath: input, conversationId } })
          }
          return
        }
        const sep = settings.defaultProjectPath.includes('\\') ? '\\' : '/'
        const workspacePath = settings.defaultProjectPath.replace(/[/\\]+$/, '') + sep + input
        const project = await autoCreateProject(input, '', workspacePath)
        if (project) {
          if (conversationId) {
            fetch(`/api/conversations/${conversationId}/project`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ projectId: project.id }),
            }).catch(() => {})
          }
          navigate(`/project-mode/${project.id}`, { state: { workspacePath, conversationId } })
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

  const renderTabContent = () => {
    if (view === 'my-projects') {
      if (loading) {
        return (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={getTransition(0.2, animationIntensity)}
            className="project-mode-loading"
          >
            <div className="project-mode-loading__spinner" />
            <div className="project-mode-loading__text">Loading projects...</div>
          </motion.div>
        )
      }

      if (projects.length === 0) {
        return (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={getTransition({ duration: 0.3 }, animationIntensity)}
            className="project-mode-empty"
          >
            <div className="project-mode-empty__icon">&#128194;</div>
            <div className="project-mode-empty__text">No projects yet. Create your first one!</div>
            <button className="project-mode-empty__btn" onClick={startNewProject}>
              New Project
            </button>
          </motion.div>
        )
      }

      return (
        <motion.div
          key="projects"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={getTransition({ duration: 0.3 }, animationIntensity)}
          className="project-card-grid"
        >
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onClick={() => handleSelectProject(project.id)}
              onDelete={(e) => { e.stopPropagation(); setProjectToDelete(project) }}
            />
          ))}
        </motion.div>
      )
    }

    // new-project view
    if (setupStep === 'loading') {
      return (
        <motion.div
          key="loading"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={getTransition(0.2, animationIntensity)}
          className="project-mode-loading"
        >
          <div className="project-mode-loading__spinner" />
          <div className="project-mode-loading__text">Setting up your environment...</div>
          <div className="project-mode-loading__subtext">This will only take a moment</div>
        </motion.div>
      )
    }

    if (setupStep === 'folder-picker') {
      return (
        <motion.div
          key="folder-picker"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={getTransition({ duration: 0.3 }, animationIntensity)}
        >
          <FolderPicker onPathSelected={handlePathSelected} isCreating={isCreating} />
        </motion.div>
      )
    }

    return null
  }

  return (
    <div className="project-mode-page">
      <div className="project-mode-page__header">
        <Link to={chatPath} className="project-mode-page__back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Chat
        </Link>
      </div>
      <div className="project-mode-dashboard">
        <div className="project-mode-tabs">
          <button
            className={`project-mode-tab${view === 'my-projects' ? ' project-mode-tab--active' : ''}`}
            onClick={() => setView('my-projects')}
          >
            My Projects
          </button>
          <button
            className={`project-mode-tab${view === 'new-project' ? ' project-mode-tab--active' : ''}`}
            onClick={startNewProject}
          >
            New Project
          </button>
        </div>
        <div className="project-mode-content">
          <AnimatePresence mode="wait">
            {renderTabContent()}
          </AnimatePresence>
        </div>
      </div>
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