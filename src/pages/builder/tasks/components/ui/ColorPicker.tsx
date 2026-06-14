import { cn } from '../../utils/helpers';
import { GROUP_COLORS } from '../../utils/constants';
import { Check } from 'lucide-react';
import { Tooltip } from './Tooltip';

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  className?: string;
}

export function ColorPicker({ value, onChange, className }: ColorPickerProps) {
  return (
    <div className={cn('grid grid-cols-6 gap-2', className)}>
      {GROUP_COLORS.map((color) => {
        const isSelected = value === color;
        return (
          <Tooltip key={color} content={color}>
            <button
              type="button"
              onClick={() => onChange(color)}
              className={cn(
                'flex items-center justify-center h-8 w-8 rounded-lg transition-all duration-150 border-2 cursor-pointer',
                isSelected
                  ? 'border-text scale-110 shadow-md'
                  : 'border-transparent hover:scale-105',
              )}
              style={{ backgroundColor: color }}
            >
              {isSelected && (
                <Check className="h-4 w-4 text-white drop-shadow-sm" />
              )}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}