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
  priority: Priority;
  groupId: string | null;
  dueDate: string | null;
  createdAt: string;
  order: number;
}

export interface TodoFilters {
  status: FilterStatus;
  search: string;
  priority: Priority | 'all';
  groupId: string | 'all' | 'ungrouped';
}

export const DEFAULT_FILTERS: TodoFilters = {
  status: 'all',
  search: '',
  priority: 'all',
  groupId: 'all',
};