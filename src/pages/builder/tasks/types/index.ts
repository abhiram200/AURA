export type Category = 'personal' | 'work' | 'shopping' | 'health' | 'learning' | 'none';
export type Priority = 'low' | 'medium' | 'high';
export type FilterStatus = 'all' | 'active' | 'completed';

export interface TaskGroup {
  id: string;
  name: string;
  color: string;
  icon: string;
  createdAt: string;
}

export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  category: Category;
  priority: Priority;
  groupId: string | null;
  dueDate: string | null;
  createdAt: string;
  order: number;
}

export interface TodoFilters {
  status: FilterStatus;
  search: string;
  category: Category | 'all';
  priority: Priority | 'all';
  groupId: string | 'all' | 'ungrouped';
}

export const DEFAULT_FILTERS: TodoFilters = {
  status: 'all',
  search: '',
  category: 'all',
  priority: 'all',
  groupId: 'all',
};