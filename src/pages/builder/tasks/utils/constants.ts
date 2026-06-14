import type { Category, Priority } from '../types';

export const CATEGORY_CONFIG: Record<Category, { label: string; color: string; bgColor: string }> = {
  personal: { label: 'Personal', color: '#7c3aed', bgColor: '#7c3aed20' },
  work: { label: 'Work', color: '#2563eb', bgColor: '#2563eb20' },
  shopping: { label: 'Shopping', color: '#d97706', bgColor: '#d9770620' },
  health: { label: 'Health', color: '#059669', bgColor: '#05966920' },
  learning: { label: 'Learning', color: '#db2777', bgColor: '#db277720' },
  none: { label: 'No Category', color: '#6b7280', bgColor: '#6b728020' },
};

export const PRIORITY_CONFIG: Record<Priority, { label: string; color: string; bgColor: string }> = {
  low: { label: 'Low', color: '#16a34a', bgColor: '#16a34a20' },
  medium: { label: 'Medium', color: '#d97706', bgColor: '#d9770620' },
  high: { label: 'High', color: '#dc2626', bgColor: '#dc262620' },
};

export const ALL_CATEGORIES: Category[] = ['personal', 'work', 'shopping', 'health', 'learning', 'none'];
export const ALL_PRIORITIES: Priority[] = ['low', 'medium', 'high'];

export const GROUP_COLORS = [
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#14b8a6', // Teal
  '#3b82f6', // Blue
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#d946ef', // Fuchsia
  '#ec4899', // Pink
  '#78716c', // Stone
  '#0ea5e9', // Sky
];

export const GROUP_ICONS = [
  'Briefcase',
  'Code',
  'GraduationCap',
  'Heart',
  'Home',
  'Lightbulb',
  'Music',
  'Palette',
  'Rocket',
  'Star',
  'Trophy',
  'Users',
  'Globe',
  'Leaf',
  'Shield',
  'Zap',
  'Coffee',
  'BookOpen',
  'Dumbbell',
  'Plane',
];