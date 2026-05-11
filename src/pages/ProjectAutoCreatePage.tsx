import { useState, useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useSettings } from '../hooks/useSettings'
import { useProjectMode } from '../hooks/useProjectMode'

type AutoCreateState = 'checking-settings' | 'no-path' | 'creating-project' | 'error'

export function ProjectAutoCreatePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { settings, loading: settingsLoading, updateSettings } = useSettings()
  const { autoCreateProject } = useProjectMode()

  const stateData = location.state as { prompt?: string; conversationId?: string | null; projectName?: string | null } | null
  const prompt = stateData?.prompt ?? ''
  const conversationId = stateData?.conversationId ?? null
  const aiProjectName = stateData?.projectName ?? null

  const chatPath = conversationId ? `/chat/${conversationId}` : '/'

  const [state, setState] = useState<AutoCreateState>('checking-settings')
  const [errorMsg, setErrorMsg] = useState('')
  const [projectName] = useState(() => aiProjectName || `project-${Date.now()}`)
  const [pathInput, setPathInput] = useState('')
  const [savingPath, setSavingPath] = useState(false)
  const started = useRef(false)

  const createProject = async (workspacePath: string) => {
    setState('creating-project')
    try {
      const project = await autoCreateProject(projectName, '', workspacePath)
      if (!project) {
        throw new Error('Failed to create project')
      }

      if (conversationId) {
        fetch(`/api/conversations/${conversationId}/project`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: project.id }),
        }).catch(() => {})
      }

      navigate(`/project-mode/${project.id}`, { state: { workspacePath, conversationId }, replace: true })
    } catch (err: any) {
      setErrorMsg(err.message || 'Something went wrong')
      setState('error')
    }
  }

  useEffect(() => {
    if (settingsLoading) return
    if (started.current) return
    if (!prompt) {
      navigate('/project-mode', { replace: true })
      return
    }
    started.current = true

    if (!settings.defaultProjectPath) {
      setState('no-path')
      return
    }

    const sep = settings.defaultProjectPath.includes('\\') ? '\\' : '/'
    const workspacePath = settings.defaultProjectPath.replace(/[/\\]+$/, '') + sep + projectName
    createProject(workspacePath)
  }, [settingsLoading, settings.defaultProjectPath, prompt, projectName, conversationId, navigate])

  const handleSetPath = async () => {
    const trimmed = pathInput.trim()
    if (!trimmed) return
    setSavingPath(true)
    try {
      await updateSettings({ defaultProjectPath: trimmed })
      const sep = trimmed.includes('\\') ? '\\' : '/'
      const workspacePath = trimmed.replace(/[/\\]+$/, '') + sep + projectName
      await createProject(workspacePath)
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save path')
      setState('error')
    } finally {
      setSavingPath(false)
    }
  }

  if (state === 'no-path') {
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
        <div className="project-mode-page__content">
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>&#128193;</div>
          <h1 className="project-mode-page__title">Set Default Project Path</h1>
          <p className="project-mode-page__description">
            To create projects automatically, set a default directory where AURA will store project folders. This path will be saved as your default for future projects.
          </p>
          <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '480px', width: '100%' }}>
            <input
              className="folder-picker__input"
              type="text"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSetPath() }}
              placeholder="C:\Projects or /home/user/projects"
              style={{ width: '100%' }}
            />
            {pathInput.trim() && (
              <div className="folder-picker__hint">
                Project will be created at: {pathInput.trim().replace(/[/\\]+$/, '')}{pathInput.trim().includes('\\') ? '\\' : '/'}{projectName}
              </div>
            )}
            <button
              className="project-mode-empty__btn"
              disabled={!pathInput.trim() || savingPath}
              onClick={handleSetPath}
            >
              {savingPath ? 'Saving...' : 'Set & Continue'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (state === 'error') {
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
        <div className="project-mode-page__content">
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>&#9888;&#65039;</div>
          <h1 className="project-mode-page__title">Project Creation Failed</h1>
          <p className="project-mode-page__description">{errorMsg}</p>
          <button
            className="project-mode-empty__btn"
            style={{ marginTop: '16px' }}
            onClick={() => navigate('/project-mode')}
          >
            Try Manually
          </button>
        </div>
      </div>
    )
  }

  const statusMessage = state === 'creating-project'
    ? `Creating project "${projectName}"...`
    : 'Setting up project...'

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
      <div className="project-mode-page__content">
        <div className="project-mode-loading__spinner" />
        <div className="project-mode-loading__text">{statusMessage}</div>
        <div className="project-mode-loading__subtext">This will only take a moment</div>
      </div>
    </div>
  )
}