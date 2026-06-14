import { create } from 'zustand'
import type { Todo, TodoFilters, Category, Priority, TaskGroup } from '../types/todo'
import { DEFAULT_FILTERS } from '../types/todo'
import { generateId } from '../utils/todoHelpers'

interface TodoState {
  todos: Todo[]
  groups: TaskGroup[]
  filters: TodoFilters
  selectedIds: string[]
  editingId: string | null
  lastCategory: Category
  lastPriority: Priority
  lastGroupId: string | null
  groupSortOrders: Record<string, 'manual' | 'priority' | 'priority-asc' | 'completed-last'>
  groupFilterPriority: Record<string, Priority | null>
  loading: boolean
  error: string | null
}

interface TodoActions {
  // Server sync
  loadFromServer: (projectId: string) => Promise<void>
  saveToServer: (projectId: string) => Promise<void>
  // Todo CRUD
  addTodo: (text: string, category: Category, priority: Priority, dueDate: string | null, groupId?: string | null) => void
  updateTodo: (id: string, updates: Partial<Omit<Todo, 'id'>>) => void
  deleteTodo: (id: string) => void
  toggleTodo: (id: string) => void
  reorderTodos: (activeId: string, overId: string, position?: 'before' | 'after') => void
  // Filters
  setFilters: (updates: Partial<TodoFilters>) => void
  resetFilters: () => void
  // Selection
  toggleSelect: (id: string) => void
  selectAll: (ids: string[]) => void
  clearSelection: () => void
  // Bulk
  bulkDelete: () => void
  bulkToggleComplete: () => void
  bulkSetCategory: (category: Category) => void
  bulkSetPriority: (priority: Priority) => void
  bulkSetGroup: (groupId: string | null) => void
  // Edit
  setEditingId: (id: string | null) => void
  clearCompleted: () => void
  // Defaults
  setLastCategory: (category: Category) => void
  setLastPriority: (priority: Priority) => void
  setLastGroupId: (groupId: string | null) => void
  // Group sort/filter
  toggleGroupSort: (groupId: string, filterActive?: boolean) => void
  setGroupFilterPriority: (groupId: string, priority: Priority | null) => void
  // Group actions
  addGroup: (name: string, color: string, icon: string) => void
  updateGroup: (id: string, updates: Partial<Omit<TaskGroup, 'id'>>) => void
  deleteGroup: (id: string) => void
  createGroupFromTodos: (name: string, color: string, icon: string, todoIds: string[]) => string
  assignTodosToGroup: (todoIds: string[], groupId: string) => void
}

export const useTodoStore = create<TodoState & TodoActions>()(
  (set, get) => ({
    todos: [],
    groups: [],
    filters: { ...DEFAULT_FILTERS },
    selectedIds: [],
    editingId: null,
    lastCategory: 'none' as Category,
    lastPriority: 'medium' as Priority,
    lastGroupId: null,
    groupSortOrders: {},
    groupFilterPriority: {},
    loading: false,
    error: null,

    loadFromServer: async (projectId: string) => {
      set({ loading: true, error: null })
      try {
        const res = await fetch(`/api/tasks/${projectId}`)
        if (!res.ok) throw new Error('Failed to load tasks')
        const data = await res.json()
        set({
          groups: data.groups ?? [],
          items: undefined, // clear stale
          todos: data.items ?? [],
          loading: false,
        })
      } catch (err) {
        set({ loading: false, error: err instanceof Error ? err.message : 'Failed to load tasks' })
      }
    },

    saveToServer: async (projectId: string) => {
      try {
        const { groups, todos } = get()
        await fetch(`/api/tasks/${projectId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groups, items: todos }),
        })
      } catch {
        // Silently fail — optimistic updates, will retry on next change
      }
    },

    addTodo: (text, category, priority, dueDate, groupId = null) => {
      const todos = get().todos
      const maxOrder = todos.length > 0 ? Math.max(...todos.map((t) => t.order)) : -1
      const newTodo: Todo = {
        id: generateId(),
        text,
        completed: false,
        category,
        priority,
        groupId,
        dueDate,
        createdAt: new Date().toISOString(),
        order: maxOrder + 1,
      }
      set({ todos: [...todos, newTodo], lastCategory: category, lastPriority: priority, lastGroupId: groupId })
    },

    updateTodo: (id, updates) => {
      set({
        todos: get().todos.map((todo) =>
          todo.id === id ? { ...todo, ...updates } : todo,
        ),
      })
    },

    deleteTodo: (id) => {
      set({ todos: get().todos.filter((todo) => todo.id !== id) })
    },

    toggleTodo: (id) => {
      set({
        todos: get().todos.map((todo) =>
          todo.id === id ? { ...todo, completed: !todo.completed } : todo,
        ),
      })
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
    },

    bulkSetCategory: (category) => {
      const { selectedIds, todos } = get()
      set({
        todos: todos.map((todo) =>
          selectedIds.includes(todo.id) ? { ...todo, category } : todo,
        ),
      })
    },

    bulkSetPriority: (priority) => {
      const { selectedIds, todos } = get()
      set({
        todos: todos.map((todo) =>
          selectedIds.includes(todo.id) ? { ...todo, priority } : todo,
        ),
      })
    },

    bulkSetGroup: (groupId) => {
      const { selectedIds, todos } = get()
      set({
        todos: todos.map((todo) =>
          selectedIds.includes(todo.id) ? { ...todo, groupId } : todo,
        ),
      })
    },

    setEditingId: (id) => {
      set({ editingId: id })
    },

    clearCompleted: () => {
      set({ todos: get().todos.filter((t) => !t.completed) })
    },

    setLastCategory: (category) => {
      set({ lastCategory: category })
    },

    setLastPriority: (priority) => {
      set({ lastPriority: priority })
    },

    setLastGroupId: (groupId) => {
      set({ lastGroupId: groupId })
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
    },

    setGroupFilterPriority: (groupId, priority) => {
      set({
        groupFilterPriority: {
          ...get().groupFilterPriority,
          [groupId]: priority,
        },
      })
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
    },

    updateGroup: (id, updates) => {
      set({
        groups: get().groups.map((group) =>
          group.id === id ? { ...group, ...updates } : group,
        ),
      })
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
      return newGroup.id
    },

    assignTodosToGroup: (todoIds, groupId) => {
      set({
        todos: get().todos.map((todo) =>
          todoIds.includes(todo.id) ? { ...todo, groupId } : todo,
        ),
      })
    },
  }),
)