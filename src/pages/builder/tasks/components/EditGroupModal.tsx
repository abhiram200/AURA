import { useState, useEffect } from 'react';
import { useTodoStore } from '../store/todoStore';
import { Modal } from './ui/Modal';
import { Input } from './ui/Input';
import { ColorPicker } from './ui/ColorPicker';
import { IconPicker } from './ui/IconPicker';
import { GROUP_COLORS } from '../utils/constants';
import { cn, getIconComponent } from '../utils/helpers';
import type { TaskGroup } from '../types';

interface EditGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: TaskGroup | null;
}

export function EditGroupModal({ isOpen, onClose, group }: EditGroupModalProps) {
  const updateGroup = useTodoStore((s) => s.updateGroup);

  const [name, setName] = useState('');
  const [color, setColor] = useState(GROUP_COLORS[5]);
  const [icon, setIcon] = useState('Briefcase');

  // Sync form state when group changes or modal opens
  useEffect(() => {
    if (group) {
      setName(group.name);
      setColor(group.color);
      setIcon(group.icon);
    }
  }, [group, isOpen]);

  const handleSave = () => {
    if (!group || !name.trim()) return;
    updateGroup(group.id, {
      name: name.trim(),
      color,
      icon,
    });
    onClose();
  };

  if (!group) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Group" className="max-w-md">
      <div className="space-y-4">
        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Project Alpha, Marketing Team"
            className="w-full"
            autoFocus
          />
        </div>

        {/* Color */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Color</label>
          <ColorPicker
            value={color}
            onChange={(c) => setColor(c)}
          />
        </div>

        {/* Icon */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Icon</label>
          <IconPicker
            value={icon}
            onChange={(i) => setIcon(i)}
            color={color}
          />
        </div>

        {/* Preview */}
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <span className="text-xs text-text-tertiary">Preview:</span>
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
            style={{
              color,
              backgroundColor: `${color}20`,
            }}
          >
            {(() => {
              const PreviewIcon = getIconComponent(icon);
              return PreviewIcon ? <PreviewIcon className="h-3 w-3" /> : null;
            })()}
            {name || 'Group Name'}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className={cn(
              'flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              name.trim()
                ? 'bg-primary text-surface hover:bg-primary-light cursor-pointer'
                : 'bg-surface-raised text-text-tertiary cursor-not-allowed',
            )}
          >
            Save Changes
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-surface transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}