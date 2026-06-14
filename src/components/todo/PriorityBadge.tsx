import { Badge } from './ui/Badge';
import { Tooltip } from './ui/Tooltip';
import { PRIORITY_CONFIG, ALL_PRIORITIES } from '../../utils/todoConstants';
import { cn } from '../../utils/todoHelpers';
import type { Priority } from '../../types/todo';

interface PriorityBadgeProps {
  priority: Priority;
  size?: 'sm' | 'md';
  onPriorityChange?: (priority: Priority) => void;
}

export function PriorityBadge({ priority, size = 'sm', onPriorityChange }: PriorityBadgeProps) {
  const config = PRIORITY_CONFIG[priority];

  const handleClick = () => {
    if (!onPriorityChange) return;
    const currentIndex = ALL_PRIORITIES.indexOf(priority);
    const nextIndex = (currentIndex + 1) % ALL_PRIORITIES.length;
    onPriorityChange(ALL_PRIORITIES[nextIndex]);
  };

  const badge = (
    <Badge
      label={config.label}
      color={config.color}
      bgColor={config.bgColor}
      size={size}
      onClick={onPriorityChange ? handleClick : undefined}
      className={cn(
        'min-w-[3.5rem] justify-center',
        onPriorityChange ? 'cursor-pointer hover:brightness-110 transition-all' : undefined,
      )}
    />
  );

  if (onPriorityChange) {
    return (
      <Tooltip content={`Priority: ${config.label} · Click to change`}>
        {badge}
      </Tooltip>
    );
  }

  return badge;
}