import { useState } from 'react';
import type { MemoryEntry } from '../../hooks/useMemory';
import { ActionMenu } from './ActionMenu';
import { Tooltip } from '../shared/Tooltip';

interface MemoryManagerProps {
  memories: MemoryEntry[];
  onAdd: (fact: string) => void;
  onUpdate: (id: string, updates: { fact?: string; active?: boolean }) => void;
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
  onRefresh: () => void;
}

export function MemoryManager({ memories, onAdd, onUpdate, onDelete, onDeleteAll, onRefresh }: MemoryManagerProps) {
  const [newFact, setNewFact] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  const handleAdd = () => {
    const trimmed = newFact.trim();
    if (trimmed) {
      onAdd(trimmed);
      setNewFact('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAdd();
  };

  const startEdit = (memory: MemoryEntry) => {
    setEditingId(memory.id);
    setEditValue(memory.fact);
  };

  const confirmEdit = () => {
    if (editingId && editValue.trim()) {
      onUpdate(editingId, { fact: editValue.trim() });
      setEditingId(null);
      setEditValue('');
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue('');
  };

  const handleDeleteAll = () => {
    if (confirmDeleteAll) {
      onDeleteAll();
      setConfirmDeleteAll(false);
    } else {
      setConfirmDeleteAll(true);
    }
  };

  const activeCount = memories.filter((m) => m.active).length;
  const inactiveCount = memories.filter((m) => !m.active).length;

  return (
    <div className="memory-manager">
      <div className="memory-manager__add">
        <input
          type="text"
          className="memory-manager__input"
          value={newFact}
          onChange={(e) => setNewFact(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a memory fact..."
        />
        <button
          className="memory-manager__add-btn"
          onClick={handleAdd}
          disabled={!newFact.trim()}
        >
          Add
        </button>
      </div>
      <div className="memory-manager__header-row">
        <div className="memory-manager__count-group">
          <span className="memory-manager__count">
            <span className="memory-manager__count--active">{activeCount} active</span>
            <span className="memory-manager__count-sep"> · </span>
            <span className="memory-manager__count--inactive">{inactiveCount} inactive</span>
          </span>
          <Tooltip content="Refresh memories">
            <button className="memory-manager__refresh-btn" onClick={onRefresh}>
              ↻
            </button>
          </Tooltip>
        </div>
        {memories.length > 0 && (
          <button
            className={`memory-manager__delete-all-btn ${confirmDeleteAll ? 'memory-manager__delete-all-btn--confirm' : ''}`}
            onClick={handleDeleteAll}
            onBlur={() => setConfirmDeleteAll(false)}
          >
            {confirmDeleteAll ? 'Confirm delete all?' : 'Delete all'}
          </button>
        )}
      </div>
      {memories.length === 0 ? (
        <p className="memory-manager__empty">No memories stored yet.</p>
      ) : (
        <ul className="memory-manager__list">
          {memories.map((memory) => (
            <li key={memory.id} className={`memory-manager__item${!memory.active ? ' memory-manager__item--inactive' : ''}`}>
              <Tooltip content={memory.active ? 'Deactivate' : 'Activate'}>
                <button
                  className={`memory-manager__toggle ${memory.active ? 'memory-manager__toggle--active' : 'memory-manager__toggle--inactive'}`}
                  onClick={() => onUpdate(memory.id, { active: !memory.active })}
                >
                  {memory.active ? '●' : '○'}
                </button>
              </Tooltip>
              {editingId === memory.id ? (
                <input
                  className="memory-manager__edit-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmEdit();
                    if (e.key === 'Escape') cancelEdit();
                  }}
                  onBlur={confirmEdit}
                  autoFocus
                />
              ) : (
                <span className="memory-manager__fact">{memory.fact}</span>
              )}
              <ActionMenu
                items={[
                  { label: 'Edit', onClick: () => startEdit(memory) },
                  { label: memory.active ? 'Deactivate' : 'Activate', onClick: () => onUpdate(memory.id, { active: !memory.active }) },
                  { label: 'Delete', onClick: () => onDelete(memory.id), danger: true },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
      {memories.length > 0 && (
        <div className="memory-manager__footer">
          <span>Click ⋮ for edit/delete options</span>
          <span>● = active &nbsp; ○ = inactive</span>
        </div>
      )}
    </div>
  );
}