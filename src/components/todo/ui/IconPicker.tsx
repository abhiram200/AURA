import { cn } from '../../../utils/todoHelpers';
import { GROUP_ICONS } from '../../../utils/todoConstants';
import { Tooltip } from './Tooltip';
import {
  Briefcase, Code, GraduationCap, Heart, Home, Lightbulb,
  Music, Palette, Rocket, Star, Trophy, Users,
  Globe, Leaf, Shield, Zap, Coffee, BookOpen,
  Dumbbell, Plane,
} from 'lucide-react';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  Briefcase, Code, GraduationCap, Heart, Home, Lightbulb,
  Music, Palette, Rocket, Star, Trophy, Users,
  Globe, Leaf, Shield, Zap, Coffee, BookOpen,
  Dumbbell, Plane,
};

interface IconPickerProps {
  value: string;
  onChange: (icon: string) => void;
  color?: string;
  className?: string;
}

export function IconPicker({ value, onChange, color, className }: IconPickerProps) {
  return (
    <div className={cn('grid grid-cols-5 gap-2', className)}>
      {GROUP_ICONS.map((iconName) => {
        const IconComponent = ICON_MAP[iconName];
        const isSelected = value === iconName;
        return (
          <Tooltip key={iconName} content={iconName}>
            <button
              type="button"
              onClick={() => onChange(iconName)}
              className={cn(
                'flex items-center justify-center h-10 w-10 rounded-lg transition-all duration-150 cursor-pointer',
                'hover:bg-surface-raised',
                isSelected
                  ? 'shadow-sm'
                  : 'bg-surface border border-border',
              )}
              style={isSelected && color ? { backgroundColor: `${color}20`, boxShadow: `0 0 0 2px ${color}` } : undefined}
            >
              {IconComponent && (
                <IconComponent
                  className="h-4 w-4"
                  style={isSelected ? { color: color || 'var(--color-primary)' } : undefined}
                />
              )}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

