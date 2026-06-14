import { useState } from 'react';
import { Pencil, Trash2, Plus, X } from 'lucide-react';
import { useTodoStore } from '../store/todoStore';
import { Modal } from './ui/Modal';
import { Input } from './ui/Input';
import { ColorPicker } from './ui/ColorPicker';
import { IconPicker } from './ui/IconPicker';
import { Tooltip } from './ui/Tooltip';
import { GROUP_COLORS } from '../utils/constants';
import { cn, getIconComponent } from '../utils/helpers';
import type { TaskGroup } from '../types';

interface GroupManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type EditingGroup = {
  id?: string;
  name: string;
  color: string;
  icon: string;
};

const DEFAULT_EDITING: EditingGroup = {
  name: '',
  color: GROUP_COLORS[5], // Blue
  icon: 'Briefcase',
};

export function GroupManagerModal({ isOpen, onClose }: GroupManagerModalProps) {
  const groups = useTodoStore((s) => s.groups);
  const addGroup = useTodoStore((s) => s.addGroup);
  const updateGroup = useTodoStore((s) => s.updateGroup);
  const deleteGroup = useTodoStore((s) => s.deleteGroup);

  const [editing, setEditing] = useState<EditingGroup | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleStartCreate = () => {
    setEditing({ ...DEFAULT_EDITING });
    setShowForm(true);
  };

  const handleStartEdit = (group: TaskGroup) => {
    setEditing({
      id: group.id,
      name: group.name,
      color: group.color,
      icon: group.icon,
    });
    setShowForm(true);
  };

  const handleSave = () => {
    if (!editing || !editing.name.trim()) return;

    if (editing.id) {
      // Update existing
      updateGroup(editing.id, {
        name: editing.name.trim(),
        color: editing.color,
        icon: editing.icon,
      });
    } else {
      // Create new
      addGroup(editing.name.trim(), editing.color, editing.icon);
    }

    setEditing(null);
    setShowForm(false);
  };

  const handleCancel = () => {
    setEditing(null);
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    deleteGroup(id);
    setDeleteConfirmId(null);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Manage Groups" className="max-w-md">
      <div className="space-y-4">
        {/* Group list */}
        {groups.length === 0 && !showForm ? (
          <div className="text-center py-8">
            <p className="text-text-tertiary text-sm mb-3">No groups yet</p>
            <p className="text-text-tertiary text-xs">
              Create a group to organize your tasks by project, team, or any context
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {groups.map((group) => {
              const Icon = getIconComponent(group.icon);
              const isDeleting = deleteConfirmId === group.id;
              return (
                <div
                  key={group.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-surface hover:border-primary/30 transition-all group"
                >
                  <span
                    className="flex items-center justify-center h-8 w-8 rounded-lg flex-shrink-0"
                    style={{ backgroundColor: `${group.color}20`, color: group.color }}
                  >
                    {Icon ? <Icon className="h-4 w-4" /> : null}
                  </span>
                  <span className="flex-1 text-sm font-medium text-text">{group.name}</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Tooltip content="Edit group">
                      <button
                        onClick={() => handleStartEdit(group)}
                        className="p-1.5 rounded-lg text-text-tertiary hover:bg-surface-raised hover:text-text transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                    {isDeleting ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleDelete(group.id)}
                          className="px-2 py-1 text-xs font-medium rounded-md bg-danger text-white hover:bg-danger/90 transition-colors"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(null)}
                          className="px-2 py-1 text-xs font-medium rounded-md bg-surface-raised text-text-secondary hover:text-text transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <Tooltip content="Delete group">
                        <button
                          onClick={() => setDeleteConfirmId(group.id)}
                          className="p-1.5 rounded-lg text-text-tertiary hover:bg-danger-light hover:text-danger transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Create/Edit form */}
        {showForm && editing ? (
          <div className="border border-border rounded-xl p-4 bg-surface-raised space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text">
                {editing.id ? 'Edit Group' : 'New Group'}
              </h3>
              <button
                onClick={handleCancel}
                className="p-1 rounded-lg text-text-tertiary hover:bg-surface hover:text-text transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Name</label>
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="e.g. Project Alpha, Marketing Team"
                className="w-full"
              />
            </div>

            {/* Color */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Color</label>
              <ColorPicker
                value={editing.color}
                onChange={(color) => setEditing({ ...editing, color })}
              />
            </div>

            {/* Icon */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Icon</label>
              <IconPicker
                value={editing.icon}
                onChange={(icon) => setEditing({ ...editing, icon })}
                color={editing.color}
              />
            </div>

            {/* Preview */}
            <div className="flex items-center gap-2 pt-2 border-t border-border">
              <span className="text-xs text-text-tertiary">Preview:</span>
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                style={{
                  color: editing.color,
                  backgroundColor: `${editing.color}20`,
                }}
              >
                {(() => {
                  const PreviewIcon = getIconComponent(editing.icon);
                  return PreviewIcon ? <PreviewIcon className="h-3 w-3" /> : null;
                })()}
                {editing.name || 'Group Name'}
              </span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleSave}
                disabled={!editing.name.trim()}
                className={cn(
                  'flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  editing.name.trim()
                    ? 'bg-primary text-surface hover:bg-primary-light'
                    : 'bg-surface-raised text-text-tertiary cursor-not-allowed',
                )}
              >
                {editing.id ? 'Save Changes' : 'Create Group'}
              </button>
              <button
                onClick={handleCancel}
                className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-surface transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={handleStartCreate}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-border text-sm font-medium text-text-tertiary hover:text-text hover:border-primary/40 hover:bg-surface transition-all"
          >
            <Plus className="h-4 w-4" />
            Create Group
          </button>
        )}
      </div>
    </Modal>
  );
}