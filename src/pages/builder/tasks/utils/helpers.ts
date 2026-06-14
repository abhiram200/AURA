import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow, isPast, isToday, isTomorrow } from 'date-fns';
import type { Todo, TodoFilters, Category, Priority } from '../types';
import {
  Briefcase, Code, GraduationCap, Heart, Home, Lightbulb,
  Music, Palette, Rocket, Star, Trophy, Users,
  Globe, Leaf, Shield, Zap, Coffee, BookOpen,
  Dumbbell, Plane,
} from 'lucide-react';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function createTodo(
  text: string,
  category: Category = 'none',
  priority: Priority = 'medium',
  dueDate: string | null = null,
  groupId: string | null = null,
): Omit<Todo, 'order'> {
  return {
    id: generateId(),
    text,
    completed: false,
    category,
    priority,
    dueDate,
    groupId,
    createdAt: new Date().toISOString(),
  };
}

export function formatDueDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isToday(date)) return 'Today';
  if (isTomorrow(date)) return 'Tomorrow';
  return format(date, 'MMM d');
}

export function formatRelativeDate(dateStr: string): string {
  return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
}

export function isOverdue(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return isPast(date) && !isToday(date);
}

export function isDueToday(dateStr: string | null): boolean {
  if (!dateStr) return false;
  return isToday(new Date(dateStr));
}

export function getFilteredTodos(todos: Todo[], filters: TodoFilters): Todo[] {
  return todos.filter((todo) => {
    if (filters.status === 'active' && todo.completed) return false;
    if (filters.status === 'completed' && !todo.completed) return false;
    if (filters.category !== 'all' && todo.category !== filters.category) return false;
    if (filters.priority !== 'all' && todo.priority !== filters.priority) return false;
    if (filters.groupId === 'ungrouped' && todo.groupId !== null) return false;
    if (filters.groupId !== 'all' && filters.groupId !== 'ungrouped' && todo.groupId !== filters.groupId) return false;
    if (filters.search) {
      const query = filters.search.toLowerCase();
      if (!todo.text.toLowerCase().includes(query)) return false;
    }
    return true;
  });
}

export function sortByOrder(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => a.order - b.order);
}

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
const PRIORITY_ORDER_ASC: Record<Priority, number> = { low: 0, medium: 1, high: 2 };

export function sortByPriority(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    // Pending first within each priority
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    // Then by priority (high → medium → low)
    return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  });
}

export function sortByPriorityAsc(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    // Pending first within each priority
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    // Then by priority (low → medium → high)
    return PRIORITY_ORDER_ASC[a.priority] - PRIORITY_ORDER_ASC[b.priority];
  });
}

export function sortWithCompletedLast(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    // Completed items always go to the end
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    // Keep original order (by order field)
    return a.order - b.order;
  });
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  Briefcase, Code, GraduationCap, Heart, Home, Lightbulb,
  Music, Palette, Rocket, Star, Trophy, Users,
  Globe, Leaf, Shield, Zap, Coffee, BookOpen,
  Dumbbell, Plane,
};

export function getIconComponent(iconName: string): React.ComponentType<{ className?: string; style?: React.CSSProperties }> | null {
  return ICON_MAP[iconName] || null;
}