import { useState, useEffect, useCallback } from 'react'
import { Link, useParams, useLocation, useNavigate } from 'react-router-dom'
import { useAura } from '../hooks/useAura'
import { WorkspacePage } from './builder/WorkspacePage'
import { AssistantPage } from './builder/AssistantPage'
import { DependenciesPage } from './builder/DependenciesPage'
import { IndexingOverlay } from '../components/aura/IndexingOverlay'

type BuilderTab = 'workspace' | 'assistant' | 'dependencies' | 'visual'

const VALID_TABS: BuilderTab[] = ['workspace', 'assistant', 'dependencies', 'visual']

function getTabFromSearch(search: string): BuilderTab {
  const params = new URLSearchParams(search)
  const tab = params.get('tab')
  if (tab && VALID_TABS.includes(tab as BuilderTab)) return tab as BuilderTab
  return 'workspace'
}

export function ProjectModeBuilderPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const [project, setProject] = useState<{ name: string; workspacePath: string; status: string; gitUrl?: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [pathMissing, setPathMissing] = useState(false)
  const [activeTab, setActiveTab] = useState<BuilderTab>(() => getTabFromSearch(location.search))
  const [pendingFileOpen, setPendingFileOpen] = useState<{ path: string; startLine?: number } | null>(null)

  // Shared aura hook — persists across tab switches
  const aura = useAura(projectId ?? null)

  const handleTabChange = useCallback((tab: BuilderTab) => {
    setActiveTab(tab)
    navigate(`/project-mode/${projectId}?tab=${tab}`, { replace: true })
  }, [projectId, navigate])

  const handleFileOpen = useCallback((filePath: string, startLine?: number) => {
    setPendingFileOpen({ path: filePath, startLine })
    setActiveTab('workspace')
    navigate(`/project-mode/${projectId}?tab=workspace`, { replace: true })
  }, [projectId, navigate])

  const handleFileOpened = useCallback(() => {
    setPendingFileOpen(null)
  }, [])

  const conversationId = (location.state as { conversationId?: string | null } | null)?.conversationId ?? null
  const backPath = conversationId ? `/chat/${conversationId}` : '/project-mode'
  const backLabel = conversationId ? 'Back to Chat' : 'Back to Projects'

  useEffect(() => {
    if (!projectId) return
    const loadProject = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}`)
        if (!res.ok) {
          setNotFound(true)
          return
        }
        const data = await res.json()
        setProject({ name: data.name, workspacePath: data.workspacePath, status: data.status, gitUrl: data.gitUrl })

        const verifyRes = await fetch(`/api/projects/${projectId}/verify`)
        if (verifyRes.ok) {
          const verifyData = await verifyRes.json()
          if (!verifyData.exists) {
            setPathMissing(true)
          }
        }
      } catch {
        setNotFound(true)
      } finally {
        setLoading(false)
      }
    }
    loadProject()
  }, [projectId])

  if (loading) {
    return (
      <div className="project-mode-page">
        <div className="project-mode-page__header">
          <Link to={backPath} className="project-mode-page__back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            {backLabel}
          </Link>
        </div>
        <div className="project-mode-page__content">
          <div className="project-mode-loading__spinner" />
          <div className="project-mode-loading__text">Loading project...</div>
        </div>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="project-mode-page">
        <div className="project-mode-page__header">
          <Link to={backPath} className="project-mode-page__back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            {backLabel}
          </Link>
        </div>
        <div className="project-mode-page__content">
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>&#128260;</div>
          <h1 className="project-mode-page__title">Project Not Found</h1>
          <p className="project-mode-page__description">This project may have been deleted.</p>
          <button
            className="project-mode-empty__btn"
            style={{ marginTop: '16px' }}
            onClick={() => window.history.back()}
          >
            Back to Projects
          </button>
        </div>
      </div>
    )
  }

  const projectName = project?.name ?? 'Project'
  const workspacePath = project?.workspacePath ?? 'Unknown'

  // Dynamic status based on what the AI is doing
  const isIndexing = aura.indexingStatus?.phase && aura.indexingStatus.phase !== 'idle' && aura.indexingStatus.phase !== 'complete' && aura.indexingStatus.phase !== 'watching'
  const statusLabel = aura.offline === 'backend' ? 'Offline' : aura.offline === 'ollama' ? 'No Ollama' : aura.isCompacting ? 'Compacting' : aura.isStreaming ? 'Thinking' : isIndexing ? 'Indexing' : 'Ready'
  const statusColor = aura.offline ? '#ef4444' : (aura.isCompacting || aura.isStreaming || isIndexing) ? '#facc15' : '#4ade80'
  const statusPulse = true

  const tabs: { key: BuilderTab; label: string; icon: JSX.Element }[] = [
    {
      key: 'workspace',
      label: 'Workspace',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>,
    },
    {
      key: 'assistant',
      label: 'Builder',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a8 8 0 0 0-8 8c0 3.4 2.1 6.3 5 7.5V20h6v-2.5c2.9-1.2 5-4.1 5-7.5a8 8 0 0 0-8-8z" /><path d="M9 20h6M10 22h4" /></svg>,
    },
    {
      key: 'dependencies',
      label: 'Dependencies',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="2" /><circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /><line x1="12" y1="10" x2="7" y2="7.4" /><line x1="12" y1="10" x2="17" y2="7.4" /><line x1="12" y1="14" x2="7" y2="16.6" /><line x1="12" y1="14" x2="17" y2="16.6" /></svg>,
    },
    ...(aura.visualCompanion ? [{
      key: 'visual' as BuilderTab,
      label: 'Visual',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>,
    }] : []),
  ]

  const tabProps = { projectId: projectId!, projectName, workspacePath, conversationId, reportActivity: aura.reportActivity }

  return (
    <div className="builder-page">
      <div className="builder-header">
        <div className="builder-header__top">
          <Link to={backPath} className="builder-header__back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            {backLabel}
          </Link>
          <div className="builder-header__tabs">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                className={`builder-header__tab${activeTab === tab.key ? ' builder-header__tab--active' : ''}`}
                onClick={() => handleTabChange(tab.key)}
              >
                <span className="builder-header__tab-icon">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>
          <span className="builder-header__status" style={{ color: statusColor }}>
            <span className={`builder-header__status-dot${statusPulse ? ' builder-header__status-dot--pulse' : ''}`} style={{ background: statusColor }} />
            {statusLabel}
          </span>
        </div>
      </div>
      {pathMissing && (
        <div className="builder-path-warning">
          &#9888;&#65039; Workspace path not found. The project folder may have been moved or deleted.
        </div>
      )}
      <div className="builder-content">
        <div className={activeTab === 'workspace' ? 'builder-tab--active' : 'builder-tab--hidden'}>
          <WorkspacePage {...tabProps} pendingFileOpen={pendingFileOpen} onFileOpened={handleFileOpened} />
        </div>
        <div className={activeTab === 'assistant' ? 'builder-tab--active' : 'builder-tab--hidden'}>
          <AssistantPage {...tabProps} aura={aura} isActive={activeTab === 'assistant'} />
        </div>
        <div className={activeTab === 'dependencies' ? 'builder-tab--active' : 'builder-tab--hidden'}>
          <DependenciesPage {...tabProps} onFileOpen={handleFileOpen} aura={aura} />
        </div>
        {aura.visualCompanion && (
          <div className={activeTab === 'visual' ? 'builder-tab--active' : 'builder-tab--hidden'}>
            <div className="visual-companion-panel">
              <div className="visual-companion-panel__header">
                <span className="visual-companion-panel__title">{aura.visualCompanion.title}</span>
              </div>
              <iframe
                className="visual-companion-panel__iframe"
                src={aura.visualCompanion.url}
                title="Visual Companion"
              />
            </div>
          </div>
        )}
      </div>
      <IndexingOverlay status={aura.indexingStatus} />
    </div>
  )
}