import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Todo, TodoFilters, Theme, Category, Priority, TaskGroup } from '../types';
import { DEFAULT_FILTERS } from '../types';
import { generateId } from '../utils/helpers';

// Migration: recover data from the old localStorage key used before rebranding
const OLD_KEY = 'todo-app-storage';
const NEW_KEY = 'tasknova-storage';
try {
  const oldData = localStorage.getItem(OLD_KEY);
  const newData = localStorage.getItem(NEW_KEY);
  if (oldData) {
    if (!newData) {
      // Only old key exists — just move it
      localStorage.setItem(NEW_KEY, oldData);
      localStorage.removeItem(OLD_KEY);
    } else {
      // Both keys exist — check if the new one is empty/default
      // (happens because Zustand already saved an empty state under the new key)
      try {
        const parsed = JSON.parse(newData);
        const parsedOld = JSON.parse(oldData);
        const oldHasTodos = Array.isArray(parsedOld?.state?.todos) && parsedOld.state.todos.length > 0;
        const newHasTodos = Array.isArray(parsed?.state?.todos) && parsed.state.todos.length > 0;
        if (oldHasTodos && !newHasTodos) {
          // Old data has real todos, new data is empty — restore from old
          localStorage.setItem(NEW_KEY, oldData);
        }
        // Either way, clean up the old key
        localStorage.removeItem(OLD_KEY);
      } catch {
        // Can't parse — prefer old data since it's more likely to have content
        localStorage.setItem(NEW_KEY, oldData);
        localStorage.removeItem(OLD_KEY);
      }
    }
  }
} catch {
  // localStorage unavailable — skip migration
}

interface TodoState {
  todos: Todo[];
  groups: TaskGroup[];
  filters: TodoFilters;
  theme: Theme;
  selectedIds: string[];
  editingId: string | null;
  lastCategory: Category;
  lastPriority: Priority;
  lastGroupId: string | null;
  groupSortOrders: Record<string, 'manual' | 'priority' | 'priority-asc' | 'completed-last'>;
  groupFilterPriority: Record<string, Priority | null>;
}

interface TodoActions {
  addTodo: (text: string, category: Category, priority: Priority, dueDate: string | null, groupId?: string | null) => void;
  updateTodo: (id: string, updates: Partial<Omit<Todo, 'id'>>) => void;
  deleteTodo: (id: string) => void;
  toggleTodo: (id: string) => void;
  reorderTodos: (activeId: string, overId: string, position?: 'before' | 'after') => void;
  setFilters: (updates: Partial<TodoFilters>) => void;
  resetFilters: () => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  toggleSelect: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  bulkDelete: () => void;
  bulkToggleComplete: () => void;
  bulkSetCategory: (category: Category) => void;
  bulkSetPriority: (priority: Priority) => void;
  bulkSetGroup: (groupId: string | null) => void;
  setEditingId: (id: string | null) => void;
  clearCompleted: () => void;
  setLastCategory: (category: Category) => void;
  setLastPriority: (priority: Priority) => void;
  setLastGroupId: (groupId: string | null) => void;
  toggleGroupSort: (groupId: string, filterActive?: boolean) => void;
  setGroupFilterPriority: (groupId: string, priority: Priority | null) => void;
  // Group actions
  addGroup: (name: string, color: string, icon: string) => void;
  updateGroup: (id: string, updates: Partial<Omit<TaskGroup, 'id'>>) => void;
  deleteGroup: (id: string) => void;
  createGroupFromTodos: (name: string, color: string, icon: string, todoIds: string[]) => string;
  assignTodosToGroup: (todoIds: string[], groupId: string) => void;
}

export const useTodoStore = create<TodoState & TodoActions>()(
  persist(
    (set, get) => ({
      todos: [],
      groups: [],
      filters: { ...DEFAULT_FILTERS },
      theme: 'light',
      selectedIds: [],
      editingId: null,
      lastCategory: 'none' as Category,
      lastPriority: 'medium' as Priority,
      lastGroupId: null,
      groupSortOrders: {},
      groupFilterPriority: {},

      addTodo: (text, category, priority, dueDate, groupId = null) => {
        const todos = get().todos;
        const maxOrder = todos.length > 0 ? Math.max(...todos.map((t) => t.order)) : -1;
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
        };
        set({ todos: [...todos, newTodo], lastCategory: category, lastPriority: priority, lastGroupId: groupId });
      },

      updateTodo: (id, updates) => {
        set({
          todos: get().todos.map((todo) =>
            todo.id === id ? { ...todo, ...updates } : todo,
          ),
        });
      },

      deleteTodo: (id) => {
        set({ todos: get().todos.filter((todo) => todo.id !== id) });
      },

      toggleTodo: (id) => {
        set({
          todos: get().todos.map((todo) =>
            todo.id === id ? { ...todo, completed: !todo.completed } : todo,
          ),
        });
      },

      reorderTodos: (activeId, overId, position: 'before' | 'after' = 'before') => {
        const todos = [...get().todos];
        const activeIndex = todos.findIndex((t) => t.id === activeId);
        const overIndex = todos.findIndex((t) => t.id === overId);
        if (activeIndex === -1 || overIndex === -1) return;

        // Remove the active item from the array
        const [activeItem] = todos.splice(activeIndex, 1);

        // Recalculate the overIndex after splice (it may have shifted)
        const newOverIndex = todos.findIndex((t) => t.id === overId);
        if (newOverIndex === -1) return;

        // Insert at the target position
        const insertIndex = position === 'before' ? newOverIndex : newOverIndex + 1;
        todos.splice(insertIndex, 0, activeItem);

        // Reassign order values based on new positions
        set({ todos: todos.map((t, i) => ({ ...t, order: i })) });
      },

      setFilters: (updates) => {
        set({ filters: { ...get().filters, ...updates } });
      },

      resetFilters: () => {
        set({ filters: { ...DEFAULT_FILTERS } });
      },

      setTheme: (theme) => {
        set({ theme });
      },

      toggleTheme: () => {
        set({ theme: get().theme === 'light' ? 'dark' : 'light' });
      },

      toggleSelect: (id) => {
        const selectedIds = get().selectedIds;
        if (selectedIds.includes(id)) {
          set({ selectedIds: selectedIds.filter((sid) => sid !== id) });
        } else {
          set({ selectedIds: [...selectedIds, id] });
        }
      },

      selectAll: (ids) => {
        set({ selectedIds: ids });
      },

      clearSelection: () => {
        set({ selectedIds: [] });
      },

      bulkDelete: () => {
        const { selectedIds, todos } = get();
        set({
          todos: todos.filter((t) => !selectedIds.includes(t.id)),
          selectedIds: [],
        });
      },

      bulkToggleComplete: () => {
        const { selectedIds, todos } = get();
        const allCompleted = selectedIds.every((id) => {
          const todo = todos.find((t) => t.id === id);
          return todo?.completed;
        });
        set({
          todos: todos.map((todo) =>
            selectedIds.includes(todo.id)
              ? { ...todo, completed: !allCompleted }
              : todo,
          ),
          selectedIds: [],
        });
      },

      bulkSetCategory: (category) => {
        const { selectedIds, todos } = get();
        set({
          todos: todos.map((todo) =>
            selectedIds.includes(todo.id) ? { ...todo, category } : todo,
          ),
        });
      },

      bulkSetPriority: (priority) => {
        const { selectedIds, todos } = get();
        set({
          todos: todos.map((todo) =>
            selectedIds.includes(todo.id) ? { ...todo, priority } : todo,
          ),
        });
      },

      bulkSetGroup: (groupId) => {
        const { selectedIds, todos } = get();
        set({
          todos: todos.map((todo) =>
            selectedIds.includes(todo.id) ? { ...todo, groupId } : todo,
          ),
        });
      },

      setEditingId: (id) => {
        set({ editingId: id });
      },

      clearCompleted: () => {
        set({ todos: get().todos.filter((t) => !t.completed) });
      },

      setLastCategory: (category) => {
        set({ lastCategory: category });
      },

      setLastPriority: (priority) => {
        set({ lastPriority: priority });
      },

      setLastGroupId: (groupId) => {
        set({ lastGroupId: groupId });
      },

      toggleGroupSort: (groupId, filterActive = false) => {
        const current = get().groupSortOrders[groupId] || 'manual';
        let next: 'manual' | 'priority' | 'priority-asc' | 'completed-last';
        if (filterActive) {
          // When filter is active: toggle between as-is and completed-last
          next = current === 'completed-last' ? 'manual' : 'completed-last';
        } else {
          // When no filter: cycle manual → priority → priority-asc → completed-last → manual
          if (current === 'manual') next = 'priority';
          else if (current === 'priority') next = 'priority-asc';
          else if (current === 'priority-asc') next = 'completed-last';
          else next = 'manual';
        }
        set({
          groupSortOrders: {
            ...get().groupSortOrders,
            [groupId]: next,
          },
        });
      },

      setGroupFilterPriority: (groupId, priority) => {
        set({
          groupFilterPriority: {
            ...get().groupFilterPriority,
            [groupId]: priority,
          },
        });
      },

      // Group actions
      addGroup: (name, color, icon) => {
        const newGroup: TaskGroup = {
          id: generateId(),
          name,
          color,
          icon,
          createdAt: new Date().toISOString(),
        };
        set({ groups: [...get().groups, newGroup] });
      },

      updateGroup: (id, updates) => {
        set({
          groups: get().groups.map((group) =>
            group.id === id ? { ...group, ...updates } : group,
          ),
        });
      },

      deleteGroup: (id) => {
        // Remove group from all todos that reference it
        set({
          groups: get().groups.filter((g) => g.id !== id),
          todos: get().todos.map((todo) =>
            todo.groupId === id ? { ...todo, groupId: null } : todo,
          ),
          // Reset filter if the deleted group was selected
          filters: get().filters.groupId === id
            ? { ...get().filters, groupId: 'all' }
            : get().filters,
        });
      },

      createGroupFromTodos: (name, color, icon, todoIds) => {
        const newGroup: TaskGroup = {
          id: generateId(),
          name,
          color,
          icon,
          createdAt: new Date().toISOString(),
        };
        set({
          groups: [...get().groups, newGroup],
          todos: get().todos.map((todo) =>
            todoIds.includes(todo.id) ? { ...todo, groupId: newGroup.id } : todo,
          ),
        });
        return newGroup.id;
      },

      assignTodosToGroup: (todoIds, groupId) => {
        set({
          todos: get().todos.map((todo) =>
            todoIds.includes(todo.id) ? { ...todo, groupId } : todo,
          ),
        });
      },
    }),
    {
      name: 'tasknova-storage',
      partialize: (state) => ({
        todos: state.todos,
        theme: state.theme,
        groups: state.groups,
        lastCategory: state.lastCategory,
        lastPriority: state.lastPriority,
        lastGroupId: state.lastGroupId,
        groupSortOrders: state.groupSortOrders,
        groupFilterPriority: state.groupFilterPriority,
      }),
    },
  ),
);