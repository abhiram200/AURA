import { readFile, writeFile, mkdir, unlink, access } from 'fs/promises'
import { join } from 'path'
import type { ProjectService } from './project.ts'

export interface TaskTodo {
  id: string
  text: string
  completed: boolean
  category: string
  priority: string
  groupId: string | null
  dueDate: string | null
  createdAt: string
  order: number
}

export interface TaskGroup {
  id: string
  name: string
  color: string
  icon: string
  createdAt: string
}

export interface ProjectTaskData {
  todos: TaskTodo[]
  groups: TaskGroup[]
  lastCategory: string
  lastPriority: string
  lastGroupId: string | null
  groupSortOrders: Record<string, string>
  groupFilterPriority: Record<string, string | null>
  updatedAt: string
}

function defaultTaskData(): ProjectTaskData {
  return {
    todos: [],
    groups: [],
    lastCategory: 'none',
    lastPriority: 'medium',
    lastGroupId: null,
    groupSortOrders: {},
    groupFilterPriority: {},
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Resolve the tasks file path for a project: <workspacePath>/.aura/tasks.json
 * Also ensures the .aura directory exists.
 */
async function resolveTasksPath(projectService: ProjectService, projectId: string): Promise<{ filePath: string; workspacePath: string } | null> {
  const project = await projectService.get(projectId)
  if (!project?.workspacePath) {
    console.warn(`[TaskService] Project not found or no workspacePath: ${projectId}`)
    return null
  }

  const auraDir = join(project.workspacePath, '.aura')
  try {
    await access(auraDir)
  } catch {
    await mkdir(auraDir, { recursive: true })
  }

  return { filePath: join(auraDir, 'tasks.json'), workspacePath: project.workspacePath }
}

export class TaskService {
  private projectService: ProjectService

  constructor(projectService: ProjectService) {
    this.projectService = projectService
  }

  async getTaskData(projectId: string): Promise<ProjectTaskData> {
    const resolved = await resolveTasksPath(this.projectService, projectId)
    if (!resolved) return defaultTaskData()

    try {
      const raw = await readFile(resolved.filePath, 'utf-8')
      return JSON.parse(raw) as ProjectTaskData
    } catch {
      return defaultTaskData()
    }
  }

  async setTaskData(projectId: string, data: Omit<ProjectTaskData, 'updatedAt'>): Promise<ProjectTaskData> {
    const resolved = await resolveTasksPath(this.projectService, projectId)
    if (!resolved) throw new Error('Project not found')

    const full: ProjectTaskData = {
      ...data,
      updatedAt: new Date().toISOString(),
    }
    await writeFile(resolved.filePath, JSON.stringify(full, null, 2), 'utf-8')
    return full
  }

  async deleteTaskData(projectId: string): Promise<void> {
    const resolved = await resolveTasksPath(this.projectService, projectId)
    if (!resolved) return

    try {
      await unlink(resolved.filePath)
    } catch {
      // File may not exist — that's fine
    }
  }
}