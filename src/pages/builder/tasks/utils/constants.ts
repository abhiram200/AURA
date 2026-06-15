import type { Priority } from '../types';

export const PRIORITY_CONFIG: Record<Priority, { label: string; color: string; bgColor: string }> = {
  low: { label: 'Low', color: '#16a34a', bgColor: '#16a34a20' },
  medium: { label: 'Medium', color: '#d97706', bgColor: '#d9770620' },
  high: { label: 'High', color: '#dc2626', bgColor: '#dc262620' },
};

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
  'Lightbulb',
  'Palette',
  'Rocket',
  'Users',
  'Globe',
  'Shield',
  'Zap',
  'BookOpen',
  'Terminal',
  'Database',
  'Bug',
  'FlaskConical',
  'FileCode',
  'Cpu',
  'BarChart3',
  'FolderGit2',
  'Webhook',
  'Blocks',
];