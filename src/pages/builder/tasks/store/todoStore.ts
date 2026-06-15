import { create } from 'zustand'
import type { Todo, TodoFilters, Priority, TaskGroup } from '../types'
import { DEFAULT_FILTERS } from '../types'
import { generateId } from '../utils/helpers'
import { fetchTaskData, saveTaskData } from '../api/taskApi'

interface TodoState {
  // Persisted (synced with server)
  todos: Todo[]
  groups: TaskGroup[]
  lastPriority: Priority
  lastGroupId: string | null
  groupSortOrders: Record<string, 'manual' | 'priority' | 'priority-asc' | 'completed-last'>
  groupFilterPriority: Record<string, Priority | null>
  // UI-only (local)
  filters: TodoFilters
  selectedIds: string[]
  editingId: string | null
  // Sync state
  isLoading: boolean
  syncError: string | null
  projectId: string | null
}

interface TodoActions {
  addTodo: (text: string, priority: Priority, dueDate: string | null, groupId?: string | null) => void
  updateTodo: (id: string, updates: Partial<Omit<Todo, 'id'>>) => void
  deleteTodo: (id: string) => void
  toggleTodo: (id: string) => void
  reorderTodos: (activeId: string, overId: string, position?: 'before' | 'after') => void
  setFilters: (updates: Partial<TodoFilters>) => void
  resetFilters: () => void
  toggleSelect: (id: string) => void
  selectAll: (ids: string[]) => void
  clearSelection: () => void
  bulkDelete: () => void
  bulkToggleComplete: () => void
  bulkSetPriority: (priority: Priority) => void
  bulkSetGroup: (groupId: string | null) => void
  setEditingId: (id: string | null) => void
  clearCompleted: () => void
  setLastPriority: (priority: Priority) => void
  setLastGroupId: (groupId: string | null) => void
  toggleGroupSort: (groupId: string, filterActive?: boolean) => void
  setGroupFilterPriority: (groupId: string, priority: Priority | null) => void
  // Group actions
  addGroup: (name: string, color: string, icon: string) => void
  updateGroup: (id: string, updates: Partial<Omit<TaskGroup, 'id'>>) => void
  deleteGroup: (id: string) => void
  createGroupFromTodos: (name: string, color: string, icon: string, todoIds: string[]) => string
  assignTodosToGroup: (todoIds: string[], groupId: string) => void
  // Server sync
  loadFromServer: (projectId: string) => Promise<void>
  _syncToServer: () => Promise<void>
}

// Debounce timer for server sync
let syncTimer: ReturnType<typeof setTimeout> | null = null

export const useTodoStore = create<TodoState & TodoActions>()(
  (set, get) => ({
    todos: [],
    groups: [],
    lastPriority: 'medium' as Priority,
    lastGroupId: null,
    groupSortOrders: {},
    groupFilterPriority: {},
    filters: { ...DEFAULT_FILTERS },
    selectedIds: [],
    editingId: null,
    isLoading: false,
    syncError: null,
    projectId: null,

    addTodo: (text, priority, dueDate, groupId = null) => {
      const todos = get().todos
      const maxOrder = todos.length > 0 ? Math.max(...todos.map((t) => t.order)) : -1
      const newTodo: Todo = {
        id: generateId(),
        text,
        completed: false,
        priority,
        groupId,
        dueDate,
        createdAt: new Date().toISOString(),
        order: maxOrder + 1,
      }
      set({ todos: [...todos, newTodo], lastPriority: priority, lastGroupId: groupId })
      get()._syncToServer()
    },

    updateTodo: (id, updates) => {
      set({
        todos: get().todos.map((todo) =>
          todo.id === id ? { ...todo, ...updates } : todo,
        ),
      })
      get()._syncToServer()
    },

    deleteTodo: (id) => {
      set({ todos: get().todos.filter((todo) => todo.id !== id) })
      get()._syncToServer()
    },

    toggleTodo: (id) => {
      set({
        todos: get().todos.map((todo) =>
          todo.id === id ? { ...todo, completed: !todo.completed } : todo,
        ),
      })
      get()._syncToServer()
    },

    reorderTodos: (activeId, overId, position: 'before' | 'after' = 'before') => {
      const todos = [...get().todos]
      const activeIndex = todos.findIndex((t) => t.id === activeId)
      const overIndex = todos.findIndex((t) => t.id === overId)
      if (activeIndex === -1 || overIndex === -1) return

      const [activeItem] = todos.splice(activeIndex, 1)
      const newOverIndex = todos.findIndex((t) => t.id === overId)
      if (newOverIndex === -1) return

      const insertIndex = position === 'before' ? newOverIndex : newOverIndex + 1
      todos.splice(insertIndex, 0, activeItem)

      set({ todos: todos.map((t, i) => ({ ...t, order: i })) })
      get()._syncToServer()
    },

    setFilters: (updates) => {
      set({ filters: { ...get().filters, ...updates } })
    },

    resetFilters: () => {
      set({ filters: { ...DEFAULT_FILTERS } })
    },

    toggleSelect: (id) => {
      const selectedIds = get().selectedIds
      if (selectedIds.includes(id)) {
        set({ selectedIds: selectedIds.filter((sid) => sid !== id) })
      } else {
        set({ selectedIds: [...selectedIds, id] })
      }
    },

    selectAll: (ids) => {
      set({ selectedIds: ids })
    },

    clearSelection: () => {
      set({ selectedIds: [] })
    },

    bulkDelete: () => {
      const { selectedIds, todos } = get()
      set({
        todos: todos.filter((t) => !selectedIds.includes(t.id)),
        selectedIds: [],
      })
      get()._syncToServer()
    },

    bulkToggleComplete: () => {
      const { selectedIds, todos } = get()
      const allCompleted = selectedIds.every((id) => {
        const todo = todos.find((t) => t.id === id)
        return todo?.completed
      })
      set({
        todos: todos.map((todo) =>
          selectedIds.includes(todo.id)
            ? { ...todo, completed: !allCompleted }
            : todo,
        ),
        selectedIds: [],
      })
      get()._syncToServer()
    },

    bulkSetPriority: (priority) => {
      const { selectedIds, todos } = get()
      set({
        todos: todos.map((todo) =>
          selectedIds.includes(todo.id) ? { ...todo, priority } : todo,
        ),
      })
      get()._syncToServer()
    },

    bulkSetGroup: (groupId) => {
      const { selectedIds, todos } = get()
      set({
        todos: todos.map((todo) =>
          selectedIds.includes(todo.id) ? { ...todo, groupId } : todo,
        ),
      })
      get()._syncToServer()
    },

    setEditingId: (id) => {
      set({ editingId: id })
    },

    clearCompleted: () => {
      set({ todos: get().todos.filter((t) => !t.completed) })
      get()._syncToServer()
    },

    setLastPriority: (priority) => {
      set({ lastPriority: priority })
      get()._syncToServer()
    },

    setLastGroupId: (groupId) => {
      set({ lastGroupId: groupId })
      get()._syncToServer()
    },

    toggleGroupSort: (groupId, filterActive = false) => {
      const current = get().groupSortOrders[groupId] || 'manual'
      let next: 'manual' | 'priority' | 'priority-asc' | 'completed-last'
      if (filterActive) {
        next = current === 'completed-last' ? 'manual' : 'completed-last'
      } else {
        if (current === 'manual') next = 'priority'
        else if (current === 'priority') next = 'priority-asc'
        else if (current === 'priority-asc') next = 'completed-last'
        else next = 'manual'
      }
      set({
        groupSortOrders: {
          ...get().groupSortOrders,
          [groupId]: next,
        },
      })
      get()._syncToServer()
    },

    setGroupFilterPriority: (groupId, priority) => {
      set({
        groupFilterPriority: {
          ...get().groupFilterPriority,
          [groupId]: priority,
        },
      })
      get()._syncToServer()
    },

    addGroup: (name, color, icon) => {
      const newGroup: TaskGroup = {
        id: generateId(),
        name,
        color,
        icon,
        createdAt: new Date().toISOString(),
      }
      set({ groups: [...get().groups, newGroup] })
      get()._syncToServer()
    },

    updateGroup: (id, updates) => {
      set({
        groups: get().groups.map((group) =>
          group.id === id ? { ...group, ...updates } : group,
        ),
      })
      get()._syncToServer()
    },

    deleteGroup: (id) => {
      set({
        groups: get().groups.filter((g) => g.id !== id),
        todos: get().todos.map((todo) =>
          todo.groupId === id ? { ...todo, groupId: null } : todo,
        ),
        filters: get().filters.groupId === id
          ? { ...get().filters, groupId: 'all' }
          : get().filters,
      })
      get()._syncToServer()
    },

    createGroupFromTodos: (name, color, icon, todoIds) => {
      const newGroup: TaskGroup = {
        id: generateId(),
        name,
        color,
        icon,
        createdAt: new Date().toISOString(),
      }
      set({
        groups: [...get().groups, newGroup],
        todos: get().todos.map((todo) =>
          todoIds.includes(todo.id) ? { ...todo, groupId: newGroup.id } : todo,
        ),
      })
      get()._syncToServer()
      return newGroup.id
    },

    assignTodosToGroup: (todoIds, groupId) => {
      set({
        todos: get().todos.map((todo) =>
          todoIds.includes(todo.id) ? { ...todo, groupId } : todo,
        ),
      })
      get()._syncToServer()
    },

    // Server sync actions
    loadFromServer: async (projectId: string) => {
      // Cancel any pending sync from the previous project
      if (syncTimer) clearTimeout(syncTimer)

      // Immediately clear previous project data so it doesn't leak across projects
      set({
        isLoading: true,
        syncError: null,
        projectId,
        todos: [],
        groups: [],
        lastPriority: 'medium' as Priority,
        lastGroupId: null,
        groupSortOrders: {},
        groupFilterPriority: {},
        filters: { ...DEFAULT_FILTERS },
        selectedIds: [],
        editingId: null,
      })
      try {
        const data = await fetchTaskData(projectId)

        // Migration: if server data is empty and localStorage has data, migrate it
        let todos = data.todos
        let groups = data.groups
        let lastPriority = data.lastPriority as Priority
        let lastGroupId = data.lastGroupId
        let groupSortOrders = (data.groupSortOrders ?? {}) as Record<string, 'manual' | 'priority' | 'priority-asc' | 'completed-last'>
        let groupFilterPriority = (data.groupFilterPriority ?? {}) as Record<string, Priority | null>

        if (todos.length === 0 && groups.length === 0) {
          try {
            const localRaw = localStorage.getItem('tasknova-storage')
            if (localRaw) {
              const parsed = JSON.parse(localRaw)
              const localState = parsed?.state
              if (localState && Array.isArray(localState.todos) && localState.todos.length > 0) {
                todos = localState.todos
                groups = localState.groups ?? []
                lastPriority = localState.lastPriority ?? 'medium'
                lastGroupId = localState.lastGroupId ?? null
                groupSortOrders = localState.groupSortOrders ?? {}
                groupFilterPriority = localState.groupFilterPriority ?? {}
                // Push migrated data to server
                await saveTaskData(projectId, { todos, groups, lastPriority, lastGroupId, groupSortOrders, groupFilterPriority })
                // Clear localStorage after migration
                localStorage.removeItem('tasknova-storage')
                localStorage.removeItem('todo-app-storage')
              }
            }
          } catch {
            // Ignore localStorage errors during migration
          }
        }

        set({
          projectId,
          todos,
          groups,
          lastPriority,
          lastGroupId,
          groupSortOrders,
          groupFilterPriority,
          isLoading: false,
        })
      } catch (e) {
        set({
          isLoading: false,
          syncError: e instanceof Error ? e.message : 'Failed to load tasks',
        })
      }
    },

    _syncToServer: async () => {
      const { projectId, todos, groups, lastPriority, lastGroupId, groupSortOrders, groupFilterPriority } = get()
      if (!projectId) return

      // Debounce: clear any pending sync and schedule a new one
      if (syncTimer) clearTimeout(syncTimer)
      syncTimer = setTimeout(async () => {
        try {
          await saveTaskData(projectId, { todos, groups, lastPriority, lastGroupId, groupSortOrders, groupFilterPriority })
          set({ syncError: null })
        } catch (e) {
          set({ syncError: e instanceof Error ? e.message : 'Sync failed' })
        }
      }, 150)
    },
  }),
)