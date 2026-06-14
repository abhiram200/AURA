import { useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Layers, Check, Plus } from 'lucide-react';
import { useTodoStore } from '../../store/todoStore';
import { cn, getIconComponent } from '../../utils/helpers';
import { GROUP_COLORS, GROUP_ICONS } from '../../utils/constants';
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

interface GroupSelectProps {
  value: string | null;
  onValueChange: (value: string | null) => void;
  className?: string;
}

export function GroupSelect({ value, onValueChange, className }: GroupSelectProps) {
  const groups = useTodoStore((s) => s.groups);
  const addGroup = useTodoStore((s) => s.addGroup);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(GROUP_COLORS[5]);
  const [newIcon, setNewIcon] = useState('Briefcase');
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const selectedGroup = groups.find((g) => g.id === value);
  const SelectedIcon = selectedGroup ? getIconComponent(selectedGroup.icon) : null;

  useLayoutEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }
  }, [open, creating]);

  useLayoutEffect(() => {
    if (creating && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [creating]);

  useLayoutEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
      setCreating(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setCreating(false);
      }
    }
    const id = setTimeout(() => {
      document.addEventListener('mousedown', handleMouseDown);
      document.addEventListener('keydown', handleKeyDown);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleCreateGroup = () => {
    if (!newName.trim()) return;
    addGroup(newName.trim(), newColor, newIcon);
    // The new group will be the last one in the array; find it by name+color+icon match
    const newGroup = useTodoStore.getState().groups.find(
      (g) => g.name === newName.trim() && g.color === newColor && g.icon === newIcon
    );
    if (newGroup) {
      onValueChange(newGroup.id);
    }
    setNewName('');
    setNewColor(GROUP_COLORS[5]);
    setNewIcon('Briefcase');
    setCreating(false);
    setOpen(false);
  };

  return (
    <div className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm w-full',
          'hover:border-text-tertiary/40 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary',
          'transition-all duration-150',
        )}
      >
        <span
          className="flex items-center justify-center h-6 w-6 rounded-md transition-colors"
          style={
            selectedGroup
              ? { backgroundColor: `${selectedGroup.color}20`, color: selectedGroup.color }
              : { backgroundColor: 'var(--color-surface-raised)', color: 'var(--color-text-tertiary)' }
          }
        >
          {SelectedIcon ? <SelectedIcon className="h-3.5 w-3.5" /> : <Layers className="h-3.5 w-3.5" />}
        </span>
        <span className="flex-1 text-left text-text">
          {selectedGroup ? selectedGroup.name : 'No Group'}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-text-tertiary transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: 'fixed',
              top: `${pos.top}px`,
              left: `${pos.left}px`,
              minWidth: `${Math.max(pos.width, 200)}px`,
              maxHeight: creating ? 'none' : '320px',
              zIndex: 9999,
            }}
            className="rounded-xl border border-border bg-surface-raised p-1.5 shadow-xl shadow-black/20 popover-enter overflow-y-auto"
          >
            <div className="space-y-0.5">
              {/* No Group option */}
              <button
                type="button"
                onClick={() => {
                  onValueChange(null);
                  setOpen(false);
                }}
                className={cn(
                  'relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm w-full',
                  'cursor-pointer outline-none transition-all duration-150',
                  'hover:bg-surface hover:text-text',
                  !selectedGroup && 'bg-surface',
                )}
              >
                <span className="flex items-center justify-center h-6 w-6 rounded-md bg-surface text-text-tertiary">
                  <Layers className="h-3.5 w-3.5" />
                </span>
                <span className="flex-1 text-left text-text-tertiary">No Group</span>
                {!selectedGroup && <Check className="h-3.5 w-3.5 flex-shrink-0 text-primary" />}
              </button>

              {groups.map((group) => {
                const Icon = getIconComponent(group.icon);
                const isSelected = group.id === value;
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => {
                      onValueChange(group.id);
                      setOpen(false);
                    }}
                    className={cn(
                      'relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm w-full',
                      'cursor-pointer outline-none transition-all duration-150',
                      'hover:bg-surface hover:text-text',
                      isSelected && 'bg-surface',
                    )}
                  >
                    <span
                      className="flex items-center justify-center h-6 w-6 rounded-md transition-all"
                      style={{
                        backgroundColor: `${group.color}20`,
                        color: group.color,
                      }}
                    >
                      {Icon ? <Icon className="h-3.5 w-3.5" /> : <Layers className="h-3.5 w-3.5" />}
                    </span>
                    <span
                      className="flex-1 text-left"
                      style={isSelected ? { color: group.color, fontWeight: 500 } : undefined}
                    >
                      {group.name}
                    </span>
                    {isSelected && <Check className="h-3.5 w-3.5 flex-shrink-0" style={{ color: group.color }} />}
                  </button>
                );
              })}

              {/* Divider */}
              <div className="border-t border-border my-1" />

              {/* Create new group button / form */}
              {!creating ? (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm w-full cursor-pointer outline-none transition-all duration-150 hover:bg-primary/10 text-primary"
                >
                  <span className="flex items-center justify-center h-6 w-6 rounded-md bg-primary/10">
                    <Plus className="h-3.5 w-3.5" />
                  </span>
                  <span className="flex-1 text-left font-medium">Create new group</span>
                </button>
              ) : (
                <div className="p-2 space-y-2.5">
                  {/* Name input */}
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateGroup();
                    }}
                    placeholder="Group name"
                    className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                  />

                  {/* Color picker */}
                  <div className="grid grid-cols-6 gap-1.5">
                    {GROUP_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setNewColor(color)}
                        className={cn(
                          'flex items-center justify-center h-7 w-7 rounded-lg transition-all duration-150 border-2 cursor-pointer',
                          newColor === color
                            ? 'border-text scale-110 shadow-md'
                            : 'border-transparent hover:scale-105',
                        )}
                        style={{ backgroundColor: color }}
                      >
                        {newColor === color && <Check className="h-3.5 w-3.5 text-white drop-shadow-sm" />}
                      </button>
                    ))}
                  </div>

                  {/* Icon picker */}
                  <div className="grid grid-cols-5 gap-1.5">
                    {GROUP_ICONS.map((iconName) => {
                      const IconComponent = ICON_MAP[iconName];
                      const isSelected = newIcon === iconName;
                      return (
                        <button
                          key={iconName}
                          type="button"
                          onClick={() => setNewIcon(iconName)}
                          className={cn(
                            'flex items-center justify-center h-8 w-8 rounded-lg transition-all duration-150 cursor-pointer',
                            'hover:bg-surface-raised',
                            isSelected
                              ? 'shadow-sm'
                              : 'bg-surface border border-border',
                          )}
                          style={isSelected ? { backgroundColor: `${newColor}20`, boxShadow: `0 0 0 2px ${newColor}` } : undefined}
                        >
                          {IconComponent && (
                            <IconComponent
                              className="h-3.5 w-3.5"
                              style={isSelected ? { color: newColor } : undefined}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Preview */}
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-xs text-text-tertiary">Preview:</span>
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{
                        color: newColor,
                        backgroundColor: `${newColor}20`,
                      }}
                    >
                      {(() => {
                        const PreviewIcon = ICON_MAP[newIcon];
                        return PreviewIcon ? <PreviewIcon className="h-3 w-3" /> : null;
                      })()}
                      {newName || 'Group Name'}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCreateGroup}
                      disabled={!newName.trim()}
                      className={cn(
                        'flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                        newName.trim()
                          ? 'bg-primary text-surface hover:bg-primary-light cursor-pointer'
                          : 'bg-surface-raised text-text-tertiary cursor-not-allowed',
                      )}
                    >
                      Create
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCreating(false);
                        setNewName('');
                        setNewColor(GROUP_COLORS[5]);
                        setNewIcon('Briefcase');
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:bg-surface transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}