# Project Mode UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the project mode UI with a tabbed dashboard (My Projects / New Project), a full-screen builder placeholder, smart button states, and a disabled-state popover — all with placeholder data since backend comes later.

**Architecture:** Conditional rendering on two routes (`/project-mode` and `/project-mode/:projectId`). A `useProjectMode` hook manages project state. The `ProjectModeButton` component handles three button states based on conversation context. `ProjectModePopover` shows when the button is disabled.

**Tech Stack:** React 19, TypeScript, React Router, Framer Motion, existing CSS variables/theme

---

### Task 1: Add `projectModeAccepted` to Conversation type

**Files:**
- Modify: `server/storage/types.ts:20-31` (Conversation interface)
- Modify: `server/services/conversation.ts` (update method)
- Modify: `server/routes/conversations.ts` (PATCH endpoint)
- Modify: `src/hooks/useChat.ts` (acceptProjectMode to persist state)

- [ ] **Step 1: Add `projectModeAccepted` field to Conversation type**

In `server/storage/types.ts`, add the field to the `Conversation` interface after `activeLeafId`:

```typescript
export interface Conversation {
  id: string
  title: string
  messages: Message[]
  model: string
  summary: string
  summaries?: Record<string, string>
  createdAt: number
  updatedAt: number
  archived?: boolean
  activeLeafId?: string | null
  projectModeAccepted?: boolean
}
```

- [ ] **Step 2: Commit the type change**

```bash
git add server/storage/types.ts
git commit -m "feat: add projectModeAccepted field to Conversation type"
```

---

### Task 2: Add server endpoint to update projectModeAccepted

**Files:**
- Modify: `server/routes/conversations.ts` (add PATCH handler)
- Modify: `server/services/conversation.ts` (add updateProjectModeAccepted method)

- [ ] **Step 1: Add `updateProjectModeAccepted` method to ConversationService**

In `server/services/conversation.ts`, add a method that updates a conversation's `projectModeAccepted` field:

```typescript
async updateProjectModeAccepted(id: string, accepted: boolean): Promise<Conversation | null> {
  const conversation = await this.get(id)
  if (!conversation) return null
  conversation.projectModeAccepted = accepted
  conversation.updatedAt = Date.now()
  await this.store.write(`conversations/${id}.json`, conversation)
  return conversation
}
```

- [ ] **Step 2: Add PATCH endpoint for project mode acceptance**

In `server/routes/conversations.ts`, add a PATCH route:

```typescript
// PATCH /api/conversations/:id/project-mode - Update project mode acceptance
router.patch('/:id/project-mode', async (req, res) => {
  try {
    const { id } = req.params
    const { accepted } = req.body
    if (typeof accepted !== 'boolean') {
      res.status(400).json({ error: 'accepted must be a boolean' })
      return
    }
    const conversation = await conversationService.updateProjectModeAccepted(id, accepted)
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' })
      return
    }
    res.json(conversation)
  } catch (error) {
    res.status(500).json({ error: 'Failed to update project mode acceptance' })
  }
})
```

- [ ] **Step 3: Commit the server changes**

```bash
git add server/services/conversation.ts server/routes/conversations.ts
git commit -m "feat: add PATCH endpoint for project mode acceptance"
```

---

### Task 3: Update useChat to persist projectModeAccepted on accept/dismiss

**Files:**
- Modify: `src/hooks/useChat.ts:809-831` (acceptProjectMode and continueInChat)

- [ ] **Step 1: Update acceptProjectMode to persist projectModeAccepted=true**

In `src/hooks/useChat.ts`, modify the `acceptProjectMode` function to also PATCH the conversation:

```typescript
acceptProjectMode: () => {
  setProjectModeSuggested(false)
  const convId = lastConversationIdRef.current
  if (convId) {
    fetch('/api/chat/project-mode-choice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: convId, choice: 'accept' }),
    }).catch(() => {})
    fetch(`/api/conversations/${convId}/project-mode`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accepted: true }),
    }).catch(() => {})
  }
  navigate('/project-mode', { state: { prompt: lastUserMessageRef.current } })
},
```

- [ ] **Step 2: Update continueInChat to persist projectModeAccepted=false**

```typescript
continueInChat: () => {
  setProjectModeSuggested(false)
  const convId = lastConversationIdRef.current
  if (convId) {
    fetch('/api/chat/project-mode-choice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: convId, choice: 'dismiss' }),
    }).catch(() => {})
    fetch(`/api/conversations/${convId}/project-mode`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accepted: false }),
    }).catch(() => {})
  }
},
```

- [ ] **Step 3: Commit the useChat changes**

```bash
git add src/hooks/useChat.ts
git commit -m "feat: persist projectModeAccepted on accept/dismiss in useChat"
```

---

### Task 4: Create useProjectMode hook

**Files:**
- Create: `src/hooks/useProjectMode.ts`

- [ ] **Step 1: Write the useProjectMode hook**

Create `src/hooks/useProjectMode.ts` with placeholder data for projects:

```typescript
import { useState, useCallback } from 'react'

export interface Project {
  id: string
  name: string
  description: string
  status: 'active' | 'completed'
  createdAt: string
  workspacePath: string
}

export type ProjectModeView = 'my-projects' | 'new-project'
export type SetupStep = 'loading' | 'folder-picker' | 'builder'

// Placeholder mock projects for UI development
const MOCK_PROJECTS: Project[] = [
  {
    id: 'proj-1',
    name: 'Portfolio App',
    description: 'Personal portfolio with blog',
    status: 'active',
    createdAt: '2026-03-15',
    workspacePath: 'C:\\Projects\\portfolio',
  },
  {
    id: 'proj-2',
    name: 'Weather Dashboard',
    description: 'Real-time weather tracker',
    status: 'active',
    createdAt: '2026-03-22',
    workspacePath: 'C:\\Projects\\weather-app',
  },
  {
    id: 'proj-3',
    name: 'Chat Bot',
    description: 'Customer support bot',
    status: 'completed',
    createdAt: '2026-04-01',
    workspacePath: 'C:\\Projects\\support-bot',
  },
]

export function useProjectMode() {
  const [projects] = useState<Project[]>(MOCK_PROJECTS)
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [view, setView] = useState<ProjectModeView>('my-projects')
  const [setupStep, setSetupStep] = useState<SetupStep>('folder-picker')

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null

  const startNewProject = useCallback(() => {
    setView('new-project')
    setSetupStep('loading')
    // Simulate environment setup
    setTimeout(() => {
      setSetupStep('folder-picker')
    }, 1500)
  }, [])

  const selectProject = useCallback((projectId: string) => {
    setActiveProjectId(projectId)
  }, [])

  const goBackToDashboard = useCallback(() => {
    setActiveProjectId(null)
  }, [])

  return {
    projects,
    activeProjectId,
    activeProject,
    view,
    setView,
    setupStep,
    setSetupStep,
    startNewProject,
    selectProject,
    goBackToDashboard,
  }
}
```

- [ ] **Step 2: Commit the hook**

```bash
git add src/hooks/useProjectMode.ts
git commit -m "feat: add useProjectMode hook with mock data"
```

---

### Task 5: Create ProjectModeButton component with popover

**Files:**
- Create: `src/components/chat/ProjectModeButton.tsx`

- [ ] **Step 1: Write the ProjectModeButton component**

Create `src/components/chat/ProjectModeButton.tsx`:

```typescript
import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { GlowButton } from '../shared/GlowButton'
import { useAnimationConfig } from '../../hooks/useAnimationConfig'
import { getTransition } from '../../hooks/useAnimationConfig'

interface ProjectModeButtonProps {
  projectModeAccepted?: boolean
}

export function ProjectModeButton({ projectModeAccepted }: ProjectModeButtonProps) {
  const navigate = useNavigate()
  const { animationIntensity } = useAnimationConfig()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const buttonRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Close popover when clicking outside
  useEffect(() => {
    if (!popoverOpen) return
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setPopoverOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [popoverOpen])

  // Close popover on Escape
  useEffect(() => {
    if (!popoverOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopoverOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [popoverOpen])

  const handleClick = () => {
    if (projectModeAccepted === true) {
      // Navigate to builder for this project (placeholder: use a mock ID)
      navigate('/project-mode/proj-1')
    } else if (projectModeAccepted === undefined) {
      // New chat — navigate to dashboard
      navigate('/project-mode')
    } else {
      // Disabled state — projectModeAccepted === false (dismissed) or null
      setPopoverOpen(!popoverOpen)
    }
  }

  const handleInitiateNewProject = () => {
    setPopoverOpen(false)
    navigate('/project-mode', { state: { tab: 'new-project' } })
  }

  const isDisabled = projectModeAccepted === false

  return (
    <div className="project-mode-button-wrapper" ref={buttonRef}>
      <GlowButton
        variant="ghost"
        onClick={handleClick}
        className={isDisabled ? 'project-mode-button--disabled' : ''}
        style={isDisabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      </GlowButton>
      <AnimatePresence>
        {popoverOpen && (
          <motion.div
            ref={popoverRef}
            className="project-mode-popover"
            initial={animationIntensity !== 'subtle' ? { opacity: 0, y: -8, scale: 0.95 } : { opacity: 0 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={animationIntensity !== 'subtle' ? { opacity: 0, y: -4, scale: 0.95 } : { opacity: 0 }}
            transition={getTransition(0.15, animationIntensity)}
          >
            <div className="project-mode-popover__icon">📂</div>
            <div className="project-mode-popover__title">No Project Mode Conversation Found</div>
            <div className="project-mode-popover__message">
              This chat doesn't have an active project mode session. Would you like to start a new project?
            </div>
            <div className="project-mode-popover__actions">
              <button className="project-mode-popover__primary" onClick={handleInitiateNewProject}>
                Initiate New Project
              </button>
              <button className="project-mode-popover__secondary" onClick={() => setPopoverOpen(false)}>
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
```

- [ ] **Step 2: Add the popover CSS**

Add to `src/styles/global.css`:

```css
/* ===== Project Mode Button & Popover ===== */

.project-mode-button-wrapper {
  position: relative;
  display: inline-flex;
}

.project-mode-button--disabled {
  opacity: 0.5 !important;
  cursor: not-allowed !important;
}

.project-mode-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 300px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 20px;
  z-index: 50;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.project-mode-popover__icon {
  font-size: 24px;
  margin-bottom: 8px;
}

.project-mode-popover__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.project-mode-popover__message {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 16px;
}

.project-mode-popover__actions {
  display: flex;
  gap: 8px;
}

.project-mode-popover__primary {
  flex: 1;
  padding: 8px 14px;
  background: var(--accent-primary);
  color: var(--bg-primary);
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: opacity 0.15s;
}

.project-mode-popover__primary:hover {
  opacity: 0.85;
}

.project-mode-popover__secondary {
  padding: 8px 14px;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  transition: border-color 0.15s, color 0.15s;
}

.project-mode-popover__secondary:hover {
  border-color: var(--text-tertiary);
  color: var(--text-primary);
}
```

- [ ] **Step 3: Commit the button and popover**

```bash
git add src/components/chat/ProjectModeButton.tsx src/styles/global.css
git commit -m "feat: add ProjectModeButton with disabled-state popover"
```

---

### Task 6: Rewrite ProjectModePage as dashboard with tabs

**Files:**
- Rewrite: `src/pages/ProjectModePage.tsx`

- [ ] **Step 1: Rewrite ProjectModePage.tsx**

Replace the entire content of `src/pages/ProjectModePage.tsx` with the dashboard implementation:

```typescript
import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useProjectMode, type Project, type ProjectModeView } from '../hooks/useProjectMode'
import { useAnimationConfig } from '../hooks/useAnimationConfig'
import { getTransition } from '../hooks/useAnimationConfig'

function ProjectCard({ project, onClick }: { project: Project; onClick: () => void }) {
  const statusColor = project.status === 'active' ? '#00ff88' : 'var(--text-tertiary)'
  return (
    <button className="project-card" onClick={onClick}>
      <div className="project-card__name">{project.name}</div>
      <div className="project-card__description">{project.description}</div>
      <div className="project-card__footer">
        <span className="project-card__status" style={{ color: statusColor }}>
          {project.status === 'active' ? 'Active' : 'Completed'}
        </span>
        <span className="project-card__date">{project.createdAt}</span>
      </div>
    </button>
  )
}

function FolderPicker({ onPathSelected }: { onPathSelected: (path: string) => void }) {
  const [path, setPath] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleBrowse = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      // webkitRelativePath gives us the folder path
      const relativePath = files[0].webkitRelativePath
      const folder = relativePath.split('/')[0]
      setPath(folder)
    }
  }

  return (
    <div className="folder-picker">
      <div className="folder-picker__icon">📁</div>
      <div className="folder-picker__title">Choose your project folder</div>
      <div className="folder-picker__subtitle">
        Select a folder on your local system where the project files will be stored
      </div>
      <div className="folder-picker__input-group">
        <input
          ref={inputRef}
          type="text"
          className="folder-picker__input"
          placeholder="C:\Projects\my-app"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
      </div>
      <div className="folder-picker__actions">
        <button className="folder-picker__browse" onClick={handleBrowse}>
          📁 Browse
        </button>
        <button
          className="folder-picker__continue"
          disabled={!path.trim()}
          onClick={() => onPathSelected(path.trim())}
        >
          Continue
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={handleFileChange}
      />
    </div>
  )
}

import { useRef } from 'react'

export function ProjectModePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { animationIntensity } = useAnimationConfig()
  const { projects, view, setView, setupStep, setSetupStep, selectProject, startNewProject } = useProjectMode()
  const [selectedPath, setSelectedPath] = useState('')

  // Check if navigated with state to show New Project tab
  useEffect(() => {
    const state = location.state as { tab?: string } | null
    if (state?.tab === 'new-project') {
      setView('new-project')
      startNewProject()
    }
  }, [location.state, setView, startNewProject])

  const handleSelectProject = (projectId: string) => {
    selectProject(projectId)
    navigate(`/project-mode/${projectId}`)
  }

  const handlePathSelected = (path: string) => {
    setSelectedPath(path)
    // Simulate transition to builder (placeholder)
    navigate(`/project-mode/proj-new`, { state: { workspacePath: path } })
  }

  return (
    <div className="project-mode-page">
      <div className="project-mode-page__header">
        <Link to="/" className="project-mode-page__back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Chat
        </Link>
      </div>
      <div className="project-mode-dashboard">
        <div className="project-mode-tabs">
          <button
            className={`project-mode-tab ${view === 'my-projects' ? 'project-mode-tab--active' : ''}`}
            onClick={() => setView('my-projects')}
          >
            My Projects
          </button>
          <button
            className={`project-mode-tab ${view === 'new-project' ? 'project-mode-tab--active' : ''}`}
            onClick={() => { setView('new-project'); startNewProject() }}
          >
            New Project
          </button>
        </div>
        <AnimatePresence mode="wait">
          {view === 'my-projects' ? (
            <motion.div
              key="my-projects"
              initial={animationIntensity !== 'subtle' ? { opacity: 0, x: -20 } : { opacity: 0 }}
              animate={{ opacity: 1, x: 0 }}
              exit={animationIntensity !== 'subtle' ? { opacity: 0, x: 20 } : { opacity: 0 }}
              transition={getTransition(0.2, animationIntensity)}
              className="project-mode-content"
            >
              {projects.length === 0 ? (
                <div className="project-mode-empty">
                  <div className="project-mode-empty__icon">📂</div>
                  <div className="project-mode-empty__text">No projects yet. Create your first project!</div>
                  <button className="project-mode-empty__btn" onClick={() => { setView('new-project'); startNewProject() }}>
                    New Project
                  </button>
                </div>
              ) : (
                <div className="project-card-grid">
                  {projects.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      onClick={() => handleSelectProject(project.id)}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="new-project"
              initial={animationIntensity !== 'subtle' ? { opacity: 0, x: 20 } : { opacity: 0 }}
              animate={{ opacity: 1, x: 0 }}
              exit={animationIntensity !== 'subtle' ? { opacity: 0, x: -20 } : { opacity: 0 }}
              transition={getTransition(0.2, animationIntensity)}
              className="project-mode-content"
            >
              <AnimatePresence mode="wait">
                {setupStep === 'loading' ? (
                  <motion.div
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="project-mode-loading"
                  >
                    <div className="project-mode-loading__spinner" />
                    <div className="project-mode-loading__text">Setting up your environment...</div>
                    <div className="project-mode-loading__subtext">Preparing project workspace</div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="folder-picker"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <FolderPicker onPathSelected={handlePathSelected} />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add dashboard CSS to global.css**

Add these styles to `src/styles/global.css` after the existing `.project-mode-page` styles:

```css
/* ===== Project Mode Dashboard ===== */

.project-mode-dashboard {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 24px;
  max-width: 800px;
  width: 100%;
  margin: 0 auto;
}

.project-mode-tabs {
  display: flex;
  border-bottom: 2px solid var(--border-color);
  margin-bottom: 24px;
}

.project-mode-tab {
  padding: 12px 24px;
  background: none;
  border: none;
  color: var(--text-tertiary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  position: relative;
  transition: color 0.2s;
}

.project-mode-tab:hover {
  color: var(--text-secondary);
}

.project-mode-tab--active {
  color: var(--accent-primary);
}

.project-mode-tab--active::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--accent-primary);
}

.project-mode-content {
  flex: 1;
}

.project-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}

.project-card {
  display: flex;
  flex-direction: column;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 16px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: inherit;
  transition: border-color 0.2s;
}

.project-card:hover {
  border-color: var(--accent-primary);
}

.project-card__name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.project-card__description {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 12px;
  line-height: 1.4;
}

.project-card__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}

.project-card__status {
  font-weight: 600;
}

.project-card__date {
  color: var(--text-tertiary);
}

.project-mode-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.project-mode-empty__icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.6;
}

.project-mode-empty__text {
  font-size: 15px;
  color: var(--text-secondary);
  margin-bottom: 16px;
}

.project-mode-empty__btn {
  padding: 10px 20px;
  background: var(--accent-primary);
  color: var(--bg-primary);
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: opacity 0.15s;
}

.project-mode-empty__btn:hover {
  opacity: 0.85;
}

.project-mode-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
}

.project-mode-loading__spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--border-color);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: pm-spin 0.8s linear infinite;
  margin-bottom: 20px;
}

@keyframes pm-spin {
  to { transform: rotate(360deg); }
}

.project-mode-loading__text {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.project-mode-loading__subtext {
  font-size: 13px;
  color: var(--text-secondary);
}

.folder-picker {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.folder-picker__icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.folder-picker__title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.folder-picker__subtitle {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 24px;
  max-width: 400px;
}

.folder-picker__input-group {
  width: 100%;
  max-width: 440px;
  margin-bottom: 16px;
}

.folder-picker__input {
  width: 100%;
  padding: 12px 16px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
  box-sizing: border-box;
}

.folder-picker__input:focus {
  border-color: var(--accent-primary);
  box-shadow: 0 0 12px var(--glow-primary);
}

.folder-picker__input::placeholder {
  color: var(--text-tertiary);
}

.folder-picker__actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.folder-picker__browse {
  padding: 10px 18px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  transition: border-color 0.15s;
}

.folder-picker__browse:hover {
  border-color: var(--accent-primary);
}

.folder-picker__continue {
  padding: 10px 24px;
  background: var(--accent-primary);
  color: var(--bg-primary);
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: opacity 0.15s;
}

.folder-picker__continue:hover:not(:disabled) {
  opacity: 0.85;
}

.folder-picker__continue:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

- [ ] **Step 3: Commit the dashboard page and CSS**

```bash
git add src/pages/ProjectModePage.tsx src/styles/global.css
git commit -m "feat: rewrite ProjectModePage as tabbed dashboard with project cards and folder picker"
```

---

### Task 7: Create ProjectModeBuilderPage

**Files:**
- Create: `src/pages/ProjectModeBuilderPage.tsx`

- [ ] **Step 1: Write the builder placeholder page**

Create `src/pages/ProjectModeBuilderPage.tsx`:

```typescript
import { Link, useParams, useLocation } from 'react-router-dom'

export function ProjectModeBuilderPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const location = useLocation()
  const state = location.state as { workspacePath?: string } | null
  const workspacePath = state?.workspacePath ?? 'Unknown'

  // Placeholder: derive name from projectId or use a default
  const projectName = projectId?.startsWith('proj-new') ? 'New Project' : projectId === 'proj-1' ? 'Portfolio App' : projectId === 'proj-2' ? 'Weather Dashboard' : projectId === 'proj-3' ? 'Chat Bot' : 'Project'

  return (
    <div className="project-mode-page">
      <div className="project-mode-page__header">
        <Link to="/project-mode" className="project-mode-page__back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </Link>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{projectName}</span>
        <span style={{ fontSize: '0.8em', color: 'var(--accent-primary)', marginLeft: 'auto' }}>Active</span>
      </div>
      <div className="project-mode-page__content">
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🛠️</div>
        <h1 className="project-mode-page__title">Project Builder</h1>
        <p className="project-mode-page__description" style={{ marginBottom: '8px' }}>
          Workspace: {workspacePath}
        </p>
        <div style={{
          marginTop: '24px',
          padding: '12px 20px',
          background: 'var(--bg-tertiary)',
          borderRadius: '8px',
          fontSize: '14px',
          color: 'var(--text-secondary)',
        }}>
          ✨ Full builder experience coming soon
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit the builder page**

```bash
git add src/pages/ProjectModeBuilderPage.tsx
git commit -m "feat: add ProjectModeBuilderPage placeholder"
```

---

### Task 8: Update App.tsx routes

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the builder route import and route**

In `src/App.tsx`, add the import for `ProjectModeBuilderPage` and the new route:

```typescript
import { ProjectModeBuilderPage } from './pages/ProjectModeBuilderPage'
```

And add the route inside `<Routes>`:

```tsx
<Route path="/project-mode" element={<ProjectModePage />} />
<Route path="/project-mode/:projectId" element={<ProjectModeBuilderPage />} />
```

- [ ] **Step 2: Commit the route change**

```bash
git add src/App.tsx
git commit -m "feat: add /project-mode/:projectId route to App"
```

---

### Task 9: Wire up ProjectModeButton in ChatLayout

**Files:**
- Modify: `src/components/chat/ChatLayout.tsx`

- [ ] **Step 1: Replace the ProjectMode button with ProjectModeButton**

In `ChatLayout.tsx`, import `ProjectModeButton`:

```typescript
import { ProjectModeButton } from './ProjectModeButton'
```

Then replace the existing project mode button block in the header actions (the `<Tooltip>` + `<GlowButton>` that navigates to `/project-mode`):

Remove this block:
```tsx
<Tooltip content="Project Mode" position="bottom">
  <GlowButton variant="ghost" onClick={() => navigate('/project-mode')}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  </GlowButton>
</Tooltip>
```

Replace with:
```tsx
<ProjectModeButton projectModeAccepted={activeConversation?.projectModeAccepted} />
```

Note: The `activeConversation` type needs `projectModeAccepted` from the updated `Conversation` type (Task 1). We'll need to also update the `Conversation` type in `useChat.ts` to match.

- [ ] **Step 2: Update the Conversation type in useChat.ts**

In `src/hooks/useChat.ts`, find the `Conversation` interface and add `projectModeAccepted`:

```typescript
export interface Conversation {
  // ... existing fields ...
  projectModeAccepted?: boolean
}
```

This ensures the type matches the server's `Conversation` type from Task 1.

- [ ] **Step 3: Commit the ChatLayout wiring**

```bash
git add src/components/chat/ChatLayout.tsx src/hooks/useChat.ts
git commit -m "feat: wire up ProjectModeButton in ChatLayout with conversation state"
```

---

### Task 10: Handle "Initiate New Project" from popover routing

**Files:**
- Modify: `src/pages/ProjectModePage.tsx` (already updated in Task 6)

- [ ] **Step 1: Verify the routing state handling works**

The `ProjectModePage` from Task 6 already handles `location.state.tab === 'new-project'` to switch to the New Project tab. Verify that the popover's "Initiate New Project" button uses:

```typescript
navigate('/project-mode', { state: { tab: 'new-project' } })
```

This is already implemented in `ProjectModeButton.tsx` from Task 5. No additional changes needed — this step is a verification checkpoint.

- [ ] **Step 2: Commit if any fixes were needed, otherwise skip**

No changes expected. Move on.

---

### Task 11: Visual review and polish

**Files:**
- Modify: `src/styles/global.css` (if needed)

- [ ] **Step 1: Start the dev server and visually verify**

Run: `npm run dev`

Check each view:
1. New chat → click project mode button → should navigate to `/project-mode` dashboard with tabs
2. My Projects tab → should show project cards → click a card → should navigate to `/project-mode/:projectId`
3. New Project tab → should show loading, then folder picker → type a path and click Continue → should navigate to builder
4. Existing chat without project mode → button should be disabled → click shows popover → "Initiate New Project" goes to new project tab
5. Existing chat with accepted project mode → button should navigate to builder

- [ ] **Step 2: Fix any visual issues found during review**

Adjust spacing, colors, or layout as needed.

- [ ] **Step 3: Commit polish fixes**

```bash
git add -A
git commit -m "style: polish project mode UI"
```