import { Badge } from './ui/Badge';
import { getIconComponent } from '../utils/helpers';
import { useTodoStore } from '../store/todoStore';

interface GroupBadgeProps {
  groupId: string | null;
  size?: 'sm' | 'md';
}

export function GroupBadge({ groupId, size = 'sm' }: GroupBadgeProps) {
  const groups = useTodoStore((s) => s.groups);

  if (!groupId) return null;
  const group = groups.find((g) => g.id === groupId);
  if (!group) return null;

  const IconComponent = getIconComponent(group.icon);

  return (
    <Badge
      label={group.name}
      color={group.color}
      bgColor={`${group.color}20`}
      size={size}
      icon={IconComponent ? <IconComponent className="h-3 w-3" style={{ color: group.color }} /> : undefined}
    />
  );
}