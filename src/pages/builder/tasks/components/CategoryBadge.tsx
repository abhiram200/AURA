import { Badge } from './ui/Badge';
import { CATEGORY_CONFIG } from '../utils/constants';
import type { Category } from '../types';

interface CategoryBadgeProps {
  category: Category;
  size?: 'sm' | 'md';
}

export function CategoryBadge({ category, size = 'sm' }: CategoryBadgeProps) {
  if (!category || category === 'none') return null;
  const config = CATEGORY_CONFIG[category] ?? CATEGORY_CONFIG.none;
  if (!config) return null;
  return (
    <Badge
      label={config.label}
      color={config.color}
      bgColor={config.bgColor}
      size={size}
    />
  );
}