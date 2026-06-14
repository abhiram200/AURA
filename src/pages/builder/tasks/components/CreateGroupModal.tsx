import { useState } from 'react';
import { useTodoStore } from '../store/todoStore';
import { Modal } from './ui/Modal';
import { Input } from './ui/Input';
import { ColorPicker } from './ui/ColorPicker';
import { IconPicker } from './ui/IconPicker';
import { GROUP_COLORS } from '../utils/constants';
import { cn, getIconComponent } from '../utils/helpers';

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  todoIds: string[];
}

export function CreateGroupModal({ isOpen, onClose, todoIds }: CreateGroupModalProps) {
  const createGroupFromTodos = useTodoStore((s) => s.createGroupFromTodos);
  const assignTodosToGroup = useTodoStore((s) => s.assignTodosToGroup);
  const groups = useTodoStore((s) => s.groups);
  const todos = useTodoStore((s) => s.todos);

  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [name, setName] = useState('');
  const [color, setColor] = useState(GROUP_COLORS[5]); // Blue default
  const [icon, setIcon] = useState('Briefcase');
  const [selectedGroupId, setSelectedGroupId] = useState('');

  const handleCreate = () => {
    if (mode === 'new') {
      if (!name.trim()) return;
      createGroupFromTodos(name.trim(), color, icon, todoIds);
    } else {
      if (!selectedGroupId) return;
      assignTodosToGroup(todoIds, selectedGroupId);
    }
    handleClose();
  };

  const handleClose = () => {
    setMode('new');
    setName('');
    setColor(GROUP_COLORS[5]);
    setIcon('Briefcase');
    setSelectedGroupId('');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Group Tasks" className="max-w-md">
      <div className="space-y-4">
        {/* Mode tabs */}
        <div className="flex rounded-lg bg-surface-raised p-1">
          <button
            type="button"
            onClick={() => setMode('new')}
            className={cn(
              'flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-all cursor-pointer',
              mode === 'new'
                ? 'bg-primary text-surface shadow-sm'
                : 'text-text-tertiary hover:text-text',
            )}
          >
            Create New
          </button>
          <button
            type="button"
            onClick={() => setMode('existing')}
            className={cn(
              'flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-all cursor-pointer',
              mode === 'existing'
                ? 'bg-primary text-surface shadow-sm'
                : 'text-text-tertiary hover:text-text',
            )}
          >
            Add to Existing
          </button>
        </div>

        {mode === 'new' ? (
          <>
            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Group Name
              </label>
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
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Color
              </label>
              <ColorPicker
                value={color}
                onChange={setColor}
              />
            </div>

            {/* Icon */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Icon
              </label>
              <IconPicker
                value={icon}
                onChange={setIcon}
                color={color}
              />
            </div>

            {/* Preview */}
            <div className="flex items-center gap-2 pt-2 border-t border-border">
              <span className="text-xs text-text-tertiary">Preview:</span>
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                style={{
                  color: color,
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
          </>
        ) : (
          <>
            {groups.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-text-tertiary text-sm">No groups yet.</p>
                <p className="text-text-tertiary text-xs mt-1">
                  Create a new group first, or switch to "Create New" tab.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {groups.map((group) => {
                  const Icon = getIconComponent(group.icon);
                  const isSelected = selectedGroupId === group.id;
                  return (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => setSelectedGroupId(group.id)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all cursor-pointer',
                        isSelected
                          ? 'border-primary/50 shadow-sm'
                          : 'border-border hover:border-primary/30 hover:bg-surface-raised',
                      )}
                      style={isSelected ? { backgroundColor: `${group.color}15` } : undefined}
                    >
                      <span
                        className="flex items-center justify-center h-8 w-8 rounded-lg flex-shrink-0"
                        style={{ backgroundColor: `${group.color}20`, color: group.color }}
                      >
                        {Icon ? <Icon className="h-4 w-4" /> : null}
                      </span>
                      <span
                        className="flex-1 text-left text-sm font-medium"
                        style={isSelected ? { color: group.color } : undefined}
                      >
                        {group.name}
                      </span>
                      <span className="text-xs text-text-tertiary">
                        {todos.filter((t) => t.groupId === group.id).length} tasks
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleCreate}
            disabled={mode === 'new' ? !name.trim() : !selectedGroupId}
            className={cn(
              'flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              (mode === 'new' && name.trim()) || (mode === 'existing' && selectedGroupId)
                ? 'bg-primary text-surface hover:bg-primary-light cursor-pointer'
                : 'bg-surface-raised text-text-tertiary cursor-not-allowed',
            )}
          >
            {mode === 'new' ? 'Create Group' : 'Add to Group'}
          </button>
          <button
            onClick={handleClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-surface transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}