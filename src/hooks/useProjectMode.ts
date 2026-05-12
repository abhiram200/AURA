import { useState, useEffect, useCallback } from 'react'

export interface Project {
  id: string
  name: string
  description: string
  workspacePath: string
  status: 'active' | 'completed'
  gitUrl?: string
  createdAt: string
  updatedAt: string
}

export type ProjectModeView = 'my-projects' | 'new-project'
export type SetupStep = 'loading' | 'folder-picker' | 'builder'

export function useProjectMode() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [view, setView] = useState<ProjectModeView>('my-projects')
  const [setupStep, setSetupStep] = useState<SetupStep>('folder-picker')

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects')
      const data = await res.json()
      setProjects(data.projects ?? [])
    } catch {
      setProjects([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  const createProject = useCallback(async (name: string, description: string, workspacePath: string): Promise<Project | null> => {
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, workspacePath }),
      })
      if (!res.ok) return null
      const project = await res.json()
      setProjects((prev) => [project, ...prev])
      return project
    } catch {
      return null
    }
  }, [])

  const autoCreateProject = useCallback(async (name: string, description: string, workspacePath: string): Promise<Project | null> => {
    try {
      const res = await fetch('/api/projects/create-with-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, workspacePath }),
      })
      if (!res.ok) return null
      const project = await res.json()
      setProjects((prev) => [project, ...prev])
      return project
    } catch {
      return null
    }
  }, [])

  const findOrCreateProject = useCallback(async (workspacePath: string, name?: string): Promise<Project | null> => {
    try {
      const res = await fetch('/api/projects/add-existing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath, name: name || undefined }),
      })
      if (!res.ok) return null
      const project = await res.json()
      setProjects((prev) => {
        if (prev.some((p) => p.id === project.id)) return prev
        return [project, ...prev]
      })
      return project
    } catch {
      return null
    }
  }, [])

  const cloneGithub = useCallback(async (url: string, name?: string): Promise<Project | null> => {
    try {
      const res = await fetch('/api/projects/clone-github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, name: name || undefined }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Clone failed' }))
        throw new Error(err.error || 'Clone failed')
      }
      const project = await res.json()
      setProjects((prev) => [project, ...prev])
      return project
    } catch (err: any) {
      throw err
    }
  }, [])

  const deleteProject = useCallback(async (id: string, deleteFiles: boolean): Promise<boolean> => {
    try {
      const url = deleteFiles ? `/api/projects/${id}/files` : `/api/projects/${id}`
      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) return false
      setProjects((prev) => prev.filter((p) => p.id !== id))
      return true
    } catch {
      return false
    }
  }, [])

  const updateProject = useCallback(async (id: string, updates: Partial<Pick<Project, 'name' | 'description' | 'status' | 'workspacePath'>>): Promise<Project | null> => {
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) return null
      const updated = await res.json()
      setProjects((prev) => prev.map((p) => (p.id === id ? updated : p)))
      return updated
    } catch {
      return null
    }
  }, [])

  const verifyProject = useCallback(async (id: string): Promise<{ exists: boolean; project: Project | null }> => {
    try {
      const res = await fetch(`/api/projects/${id}/verify`)
      if (!res.ok) return { exists: false, project: null }
      return await res.json()
    } catch {
      return { exists: false, project: null }
    }
  }, [])

  const startNewProject = useCallback(() => {
    setView('new-project')
    setSetupStep('loading')
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
    loading,
    activeProjectId,
    activeProject,
    view,
    setView,
    setupStep,
    setSetupStep,
    fetchProjects,
    createProject,
    autoCreateProject,
    findOrCreateProject,
    cloneGithub,
    deleteProject,
    updateProject,
    verifyProject,
    startNewProject,
    selectProject,
    goBackToDashboard,
  }
}