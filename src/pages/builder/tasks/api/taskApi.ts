import type { Todo, TaskGroup, Priority } from '../types'

const API_BASE = '/api/projects'

export interface PersistedTaskState {
  todos: Todo[]
  groups: TaskGroup[]
  lastPriority: Priority
  lastGroupId: string | null
  groupSortOrders: Record<string, 'manual' | 'priority' | 'priority-asc' | 'completed-last'>
  groupFilterPriority: Record<string, Priority | null>
}

interface TaskDataResponse {
  projectId: string
  todos: Todo[]
  groups: TaskGroup[]
  lastPriority: Priority
  lastGroupId: string | null
  groupSortOrders: Record<string, string>
  groupFilterPriority: Record<string, string | null>
  updatedAt: string
}

export async function fetchTaskData(projectId: string): Promise<TaskDataResponse> {
  const res = await fetch(`${API_BASE}/${projectId}/tasks`)
  if (!res.ok) throw new Error(`Failed to fetch tasks: ${res.status}`)
  return res.json()
}

export async function saveTaskData(projectId: string, data: PersistedTaskState): Promise<TaskDataResponse> {
  const res = await fetch(`${API_BASE}/${projectId}/tasks`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`Failed to save tasks: ${res.status}`)
  return res.json()
}