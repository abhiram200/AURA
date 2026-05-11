# Settings Panel Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat scrollable settings panel with a Card Grid home + overlay modals per category.

**Architecture:** SettingsPanel renders a 2-column card grid. Clicking a card sets `activeModal` state, which renders a `SettingsModal` wrapper containing the category's existing components. A shared `ActionMenu` component replaces inline toggle/delete buttons in Memory and Skills items. "Context" and "Preferences" sections are absorbed into AI Behavior and General modals respectively.

**Tech Stack:** React, framer-motion, TypeScript, CSS (BEM via global.css)

---

### Task 1: SettingsCard component

**Files:**
- Create: `src/components/settings/SettingsCard.tsx`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Create SettingsCard component**

```tsx
interface SettingsCardProps {
  icon: string;
  title: string;
  subtitle: string;
  subtitleColor?: string;
  onClick: () => void;
}

export function SettingsCard({ icon, title, subtitle, subtitleColor, onClick }: SettingsCardProps) {
  return (
    <button className="settings-card" onClick={onClick}>
      <div className="settings-card__icon">{icon}</div>
      <div className="settings-card__title">{title}</div>
      <div className="settings-card__subtitle" style={subtitleColor ? { color: subtitleColor } : undefined}>
        {subtitle}
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Add settings-card CSS**

Append to `src/styles/global.css` after the `.settings-panel__body` block:

```css
.settings-card {
  display: flex;
  flex-direction: column;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 14px;
  cursor: pointer;
  transition: border-color 0.2s ease;
  text-align: left;
  font-family: inherit;
  color: inherit;
}

.settings-card:hover {
  border-color: var(--accent-primary);
}

.settings-card--full {
  grid-column: 1 / -1;
}

.settings-card__icon {
  font-size: 20px;
  margin-bottom: 6px;
}

.settings-card__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.settings-card__subtitle {
  font-size: 10px;
  color: var(--text-tertiary);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/SettingsCard.tsx src/styles/global.css
git commit -m "feat: add SettingsCard component for card grid home"
```

---

### Task 2: SettingsModal component

**Files:**
- Create: `src/components/settings/SettingsModal.tsx`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Create SettingsModal wrapper**

```tsx
import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface SettingsModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function SettingsModal({ title, onClose, children }: SettingsModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <AnimatePresence>
      <motion.div
        className="settings-modal-backdrop"
        ref={backdropRef}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
      >
        <motion.div
          className="settings-modal"
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="settings-modal__header">
            <h3 className="settings-modal__title">{title}</h3>
            <button className="settings-modal__close" onClick={onClose}>✕</button>
          </div>
          <div className="settings-modal__body">
            {children}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Add settings-modal CSS**

Append to `src/styles/global.css` after the `.settings-card__subtitle` block:

```css
.settings-modal-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.settings-modal {
  width: 90%;
  max-width: 440px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  overflow: hidden;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.settings-modal__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}

.settings-modal__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.settings-modal__close {
  background: none;
  border: none;
  color: var(--text-tertiary);
  font-size: 16px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  transition: color 0.15s;
}

.settings-modal__close:hover {
  color: var(--text-primary);
}

.settings-modal__body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/SettingsModal.tsx src/styles/global.css
git commit -m "feat: add SettingsModal wrapper component"
```

---

### Task 3: ActionMenu component

**Files:**
- Create: `src/components/settings/ActionMenu.tsx`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Create ActionMenu component**

```tsx
import { useState, useRef, useEffect } from 'react';

export interface ActionMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface ActionMenuProps {
  items: ActionMenuItem[];
}

export function ActionMenu({ items }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="action-menu" ref={menuRef}>
      <button
        className="action-menu__trigger"
        onClick={() => setOpen(!open)}
      >
        ⋮
      </button>
      {open && (
        <div className="action-menu__dropdown">
          {items.map((item, i) => (
            <button
              key={i}
              className={`action-menu__item${item.danger ? ' action-menu__item--danger' : ''}`}
              onClick={() => {
                item.onClick();
                setOpen(false);
              }}
              disabled={item.disabled}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add action-menu CSS**

Append to `src/styles/global.css` after the `.settings-modal__body` block:

```css
.action-menu {
  position: relative;
  flex-shrink: 0;
}

.action-menu__trigger {
  background: none;
  border: none;
  color: var(--text-tertiary);
  font-size: 14px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  transition: color 0.15s;
}

.action-menu__trigger:hover {
  color: var(--text-primary);
}

.action-menu__dropdown {
  position: absolute;
  right: 0;
  top: 100%;
  z-index: 20;
  min-width: 120px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  padding: 4px;
  overflow: hidden;
}

.action-menu__item {
  display: block;
  width: 100%;
  padding: 8px 12px;
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.15s;
}

.action-menu__item:hover:not(:disabled) {
  background: var(--sidebar-hover);
}

.action-menu__item--danger {
  color: #ff4444;
}

.action-menu__item--danger:hover:not(:disabled) {
  background: rgba(255, 68, 68, 0.1);
}

.action-menu__item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/ActionMenu.tsx src/styles/global.css
git commit -m "feat: add ActionMenu shared component for ⋮ menus"
```

---

### Task 4: Update MemoryManager to use ActionMenu

**Files:**
- Modify: `src/components/settings/MemoryManager.tsx`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Rewrite MemoryManager with ⋮ menu and inline edit**

Replace the full content of `src/components/settings/MemoryManager.tsx`:

```tsx
import { useState } from 'react';
import type { MemoryEntry } from '../../hooks/useMemory';
import { ActionMenu } from './ActionMenu';
import type { ActionMenuItem } from './ActionMenu';

interface MemoryManagerProps {
  memories: MemoryEntry[];
  onAdd: (fact: string) => void;
  onUpdate: (id: string, updates: { fact?: string; active?: boolean }) => void;
  onDelete: (id: string) => void;
}

export function MemoryManager({ memories, onAdd, onUpdate, onDelete }: MemoryManagerProps) {
  const [newFact, setNewFact] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

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
      {memories.length === 0 ? (
        <p className="memory-manager__empty">No memories stored yet.</p>
      ) : (
        <ul className="memory-manager__list">
          {memories.map((memory) => (
            <li key={memory.id} className={`memory-manager__item${!memory.active ? ' memory-manager__item--inactive' : ''}`}>
              <button
                className={`memory-manager__toggle ${memory.active ? 'memory-manager__toggle--active' : 'memory-manager__toggle--inactive'}`}
                onClick={() => onUpdate(memory.id, { active: !memory.active })}
                title={memory.active ? 'Deactivate' : 'Activate'}
              >
                {memory.active ? '●' : '○'}
              </button>
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
```

- [ ] **Step 2: Update memory-manager CSS in global.css**

Find and replace the existing `.memory-manager__item` style (if it exists — it may be inline). Add these styles after the `.action-menu__item:disabled` block:

```css
.memory-manager__add {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.memory-manager__input {
  flex: 1;
  padding: 8px 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 12px;
  font-family: inherit;
  outline: none;
}

.memory-manager__input:focus {
  border-color: var(--accent-primary);
}

.memory-manager__add-btn {
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}

.memory-manager__add-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.memory-manager__empty {
  font-size: 12px;
  color: var(--text-tertiary);
  font-style: italic;
}

.memory-manager__list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.memory-manager__item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 10px 12px;
}

.memory-manager__item--inactive {
  opacity: 0.5;
}

.memory-manager__item--inactive .memory-manager__fact {
  text-decoration: line-through;
  color: var(--text-tertiary);
}

.memory-manager__toggle {
  background: none;
  border: none;
  font-size: 14px;
  cursor: pointer;
  padding: 0;
  margin-top: 2px;
  line-height: 1;
}

.memory-manager__toggle--active {
  color: var(--accent-primary);
}

.memory-manager__toggle--inactive {
  color: var(--text-tertiary);
}

.memory-manager__fact {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--text-primary);
  line-height: 1.4;
}

.memory-manager__edit-input {
  flex: 1;
  min-width: 0;
  background: var(--bg-primary);
  border: 1px solid var(--accent-primary);
  border-radius: 4px;
  padding: 4px 8px;
  color: var(--text-primary);
  font-size: 12px;
  font-family: inherit;
  outline: none;
}

.memory-manager__delete {
  background: none;
  border: none;
  color: var(--text-tertiary);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}

.memory-manager__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
  margin-top: 12px;
  font-size: 10px;
  color: var(--text-tertiary);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/MemoryManager.tsx src/styles/global.css
git commit -m "feat: update MemoryManager with ⋮ action menu and inline edit"
```

---

### Task 5: Update SkillsManager to use ActionMenu

**Files:**
- Modify: `src/components/settings/SkillsManager.tsx`

- [ ] **Step 1: Rewrite SkillsManager with ⋮ menu and status badges**

Replace the full content of `src/components/settings/SkillsManager.tsx`:

```tsx
import { useState } from 'react';
import type { SkillEntry } from '../../hooks/useSkills';
import { ActionMenu } from './ActionMenu';
import type { ActionMenuItem } from './ActionMenu';

interface SkillsManagerProps {
  skills: SkillEntry[];
  onToggle: (id: string, active: boolean) => void;
  onDelete: (id: string) => void;
  onAdd: (definition: SkillEntry['definition'], handler: SkillEntry['handler']) => void;
}

const EXAMPLE_JSON = `{
  "type": "function",
  "function": {
    "name": "calculate",
    "description": "Evaluate a mathematical expression",
    "parameters": {
      "type": "object",
      "properties": {
        "expression": {
          "type": "string",
          "description": "The math expression to evaluate, e.g. '2 + 2 * 3'"
        }
      },
      "required": ["expression"]
    }
  }
}`;

export function SkillsManager({ skills, onToggle, onDelete, onAdd }: SkillsManagerProps) {
  const [showModal, setShowModal] = useState(false);
  const [jsonInput, setJsonInput] = useState('');
  const [handlerType, setHandlerType] = useState<'prompt' | 'api'>('prompt');
  const [apiUrl, setApiUrl] = useState('');
  const [apiMethod, setApiMethod] = useState('POST');
  const [parseError, setParseError] = useState('');

  const activeCount = skills.filter((s) => s.active).length;
  const inactiveCount = skills.length - activeCount;

  const handleAdd = () => {
    setParseError('');
    try {
      const definition = JSON.parse(jsonInput);
      const handler: SkillEntry['handler'] =
        handlerType === 'api'
          ? { type: 'api', url: apiUrl, method: apiMethod }
          : { type: 'prompt' };
      onAdd(definition, handler);
      setShowModal(false);
      setJsonInput('');
      setApiUrl('');
      setApiMethod('POST');
      setHandlerType('prompt');
    } catch {
      setParseError('Invalid JSON. Please check the format and try again.');
    }
  };

  const handleCancel = () => {
    setShowModal(false);
    setJsonInput('');
    setApiUrl('');
    setApiMethod('POST');
    setHandlerType('prompt');
    setParseError('');
  };

  return (
    <div className="skills-manager">
      <div className="skills-manager__header-row">
        <span className="skills-manager__count">
          {activeCount} active · {inactiveCount} inactive
        </span>
        <button className="skills-manager__add-btn" onClick={() => setShowModal(true)}>
          + Add Skill
        </button>
      </div>
      {skills.length === 0 ? (
        <p className="skills-manager__empty">No skills configured.</p>
      ) : (
        <ul className="skills-manager__list">
          {skills.map((skill) => {
            const isBuiltin = skill.id.startsWith('skill_builtin_');
            return (
              <li key={skill.id} className={`skills-manager__item${!skill.active ? ' skills-manager__item--inactive' : ''}`}>
                <button
                  className={`skills-manager__toggle ${skill.active ? 'skills-manager__toggle--active' : 'skills-manager__toggle--inactive'}`}
                  onClick={() => onToggle(skill.id, !skill.active)}
                  title={skill.active ? 'Deactivate' : 'Activate'}
                >
                  {skill.active ? '●' : '○'}
                </button>
                <div className="skills-manager__info">
                  <span className="skills-manager__name">{skill.name}</span>
                  <span className="skills-manager__handler-type">{skill.handler.type} handler</span>
                </div>
                <span className={`skills-manager__badge ${skill.active ? 'skills-manager__badge--active' : 'skills-manager__badge--inactive'}`}>
                  {skill.active ? 'active' : 'inactive'}
                </span>
                <ActionMenu
                  items={[
                    { label: skill.active ? 'Deactivate' : 'Activate', onClick: () => onToggle(skill.id, !skill.active) },
                    { label: 'Delete', onClick: () => onDelete(skill.id), danger: true, disabled: isBuiltin },
                  ]}
                />
              </li>
            );
          })}
        </ul>
      )}
      <div className="skills-manager__footer">
        Click ●/○ to toggle · ⋮ for delete
      </div>

      {showModal && (
        <div className="skills-manager__overlay" onClick={handleCancel}>
          <div className="skills-manager__modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="skills-manager__modal-title">Add Custom Skill</h3>
            <p className="skills-manager__modal-hint">
              Paste a JSON function definition in OpenAI tool format. Define the name, description,
              and parameters for your skill.
            </p>
            <div className="skills-manager__example">
              <pre className="skills-manager__example-code">{EXAMPLE_JSON}</pre>
            </div>
            <p className="skills-manager__modal-hint">
              <strong>name</strong> — the skill function name.{' '}
              <strong>description</strong> — what the skill does.{' '}
              <strong>parameters</strong> — JSON Schema for the skill inputs.
            </p>
            <textarea
              className="skills-manager__textarea"
              value={jsonInput}
              onChange={(e) => {
                setJsonInput(e.target.value);
                setParseError('');
              }}
              placeholder="Paste your JSON definition here..."
              rows={6}
            />
            <div className="skills-manager__handler-row">
              <label className="skills-manager__handler-label">Handler Type</label>
              <div className="skills-manager__handler-pills">
                <button
                  className={`skills-manager__handler-pill${handlerType === 'prompt' ? ' skills-manager__handler-pill--active' : ''}`}
                  onClick={() => setHandlerType('prompt')}
                >
                  Prompt
                </button>
                <button
                  className={`skills-manager__handler-pill${handlerType === 'api' ? ' skills-manager__handler-pill--active' : ''}`}
                  onClick={() => setHandlerType('api')}
                >
                  API
                </button>
              </div>
            </div>
            {handlerType === 'api' && (
              <div className="skills-manager__api-fields">
                <div className="skills-manager__handler-row">
                  <label className="skills-manager__handler-label">API URL</label>
                  <input
                    type="text"
                    className="skills-manager__handler-input"
                    value={apiUrl}
                    onChange={(e) => setApiUrl(e.target.value)}
                    placeholder="https://api.example.com/endpoint"
                  />
                </div>
                <div className="skills-manager__handler-row">
                  <label className="skills-manager__handler-label">Method</label>
                  <select
                    className="skills-manager__handler-select"
                    value={apiMethod}
                    onChange={(e) => setApiMethod(e.target.value)}
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="DELETE">DELETE</option>
                  </select>
                </div>
              </div>
            )}
            {parseError && <p className="skills-manager__error">{parseError}</p>}
            <div className="skills-manager__modal-actions">
              <button className="skills-manager__cancel-btn" onClick={handleCancel}>
                Cancel
              </button>
              <button className="skills-manager__confirm-btn" onClick={handleAdd}>
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add skills-manager CSS**

Append to `src/styles/global.css` after the `.memory-manager__footer` block:

```css
.skills-manager__header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.skills-manager__count {
  font-size: 11px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.skills-manager__add-btn {
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  border: none;
  border-radius: 6px;
  padding: 6px 14px;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}

.skills-manager__empty {
  font-size: 12px;
  color: var(--text-tertiary);
  font-style: italic;
}

.skills-manager__list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skills-manager__item {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 10px 12px;
}

.skills-manager__item--inactive {
  opacity: 0.5;
}

.skills-manager__toggle {
  background: none;
  border: none;
  font-size: 14px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.skills-manager__toggle--active {
  color: var(--accent-primary);
}

.skills-manager__toggle--inactive {
  color: var(--text-tertiary);
}

.skills-manager__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.skills-manager__name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.skills-manager__handler-type {
  font-size: 10px;
  color: var(--text-tertiary);
}

.skills-manager__badge {
  font-size: 9px;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid;
  flex-shrink: 0;
}

.skills-manager__badge--active {
  color: var(--accent-primary);
  border-color: var(--accent-primary);
  background: rgba(0, 240, 255, 0.05);
}

.skills-manager__badge--inactive {
  color: #ff4444;
  border-color: #ff4444;
  background: rgba(255, 68, 68, 0.05);
}

.skills-manager__footer {
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
  margin-top: 12px;
  font-size: 10px;
  color: var(--text-tertiary);
}

.skills-manager__overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}

.skills-manager__modal {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 20px;
  max-width: 440px;
  width: 90%;
}

.skills-manager__modal-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 12px;
}

.skills-manager__modal-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.5;
  margin-bottom: 12px;
}

.skills-manager__example {
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}

.skills-manager__example-code {
  font-size: 10px;
  color: var(--text-tertiary);
  margin: 0;
  white-space: pre-wrap;
}

.skills-manager__textarea {
  width: 100%;
  padding: 10px 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 11px;
  font-family: monospace;
  min-height: 80px;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}

.skills-manager__handler-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
}

.skills-manager__handler-label {
  font-size: 11px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.skills-manager__handler-pills {
  display: flex;
  gap: 6px;
}

.skills-manager__handler-pill {
  padding: 5px 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-tertiary);
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
}

.skills-manager__handler-pill--active {
  border-color: var(--accent-primary);
  color: var(--accent-primary);
}

.skills-manager__handler-input {
  flex: 1;
  padding: 6px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
}

.skills-manager__handler-select {
  padding: 6px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
  cursor: pointer;
}

.skills-manager__error {
  color: #ff4444;
  font-size: 12px;
  margin-top: 8px;
}

.skills-manager__modal-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.skills-manager__cancel-btn {
  flex: 1;
  padding: 8px;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-tertiary);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}

.skills-manager__confirm-btn {
  flex: 1;
  padding: 8px;
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  border: none;
  border-radius: 6px;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}

.skills-manager__overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}

.skills-manager__api-fields {
  margin-top: 8px;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/SkillsManager.tsx src/styles/global.css
git commit -m "feat: update SkillsManager with ⋮ action menu and status badges"
```

---

### Task 6: Rewrite SettingsPanel with Card Grid + Modals

**Files:**
- Modify: `src/components/settings/SettingsPanel.tsx`
- Modify: `src/styles/global.css`
- Delete: `src/components/settings/SettingsSection.tsx`

- [ ] **Step 1: Rewrite SettingsPanel.tsx**

Replace the full content of `src/components/settings/SettingsPanel.tsx`:

```tsx
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AppSettings, OllamaModel, UserPreferences as UserPreferencesType } from '../../hooks/useSettings';
import type { MemoryEntry } from '../../hooks/useMemory';
import type { SkillEntry } from '../../hooks/useSkills';
import type { ConversationSummary } from '../../hooks/useChat';
import { SettingsCard } from './SettingsCard';
import { SettingsModal } from './SettingsModal';
import { ModelSelection } from './ModelSelection';
import { SystemPromptEditor } from './SystemPromptEditor';
import { AIPreferences } from './AIPreferences';
import { ContextSettings } from './ContextSettings';
import { MemoryManager } from './MemoryManager';
import { SkillsManager } from './SkillsManager';
import { ArchivedChats } from './ArchivedChats';
import { useTheme } from '../../hooks/useTheme';
import type { AnimationIntensity } from '../../hooks/useTheme';

type ModalType = 'general' | 'ai-behavior' | 'memory' | 'skills' | 'archived' | null;

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  systemPrompt: string;
  onSystemPromptChange: (value: string) => void;
  settings: AppSettings;
  models: OllamaModel[];
  onSettingsChange: (updates: Partial<AppSettings>) => void;
  onPreferenceChange: (key: keyof UserPreferencesType, value: string | null) => void;
  memories: MemoryEntry[];
  onAddMemory: (fact: string) => void;
  onUpdateMemory: (id: string, updates: { fact?: string; active?: boolean }) => void;
  onDeleteMemory: (id: string) => void;
  skills: SkillEntry[];
  onToggleSkill: (id: string, active: boolean) => void;
  onDeleteSkill: (id: string) => void;
  onAddSkill: (definition: SkillEntry['definition'], handler: SkillEntry['handler']) => void;
  conversations: ConversationSummary[];
  onSelectConversation: (id: string) => void;
  onUnarchiveConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
}

export function SettingsPanel({
  isOpen,
  onClose,
  systemPrompt,
  onSystemPromptChange,
  settings,
  models,
  onSettingsChange,
  onPreferenceChange,
  memories,
  onAddMemory,
  onUpdateMemory,
  onDeleteMemory,
  skills,
  onToggleSkill,
  onDeleteSkill,
  onAddSkill,
  conversations,
  onSelectConversation,
  onUnarchiveConversation,
  onDeleteConversation,
}: SettingsPanelProps) {
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const { theme, toggleTheme, animationIntensity, setAnimationIntensity, fontSize, setFontSize } = useTheme();

  const activeMemories = memories.filter((m) => m.active).length;
  const activeSkills = skills.filter((s) => s.active).length;
  const archivedCount = conversations.filter((c) => c.archived).length;

  const closeModal = () => setActiveModal(null);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="settings-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="settings-panel"
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            <div className="settings-panel__header">
              <h2>Settings</h2>
              <button className="settings-panel__close" onClick={onClose}>✕</button>
            </div>
            <div className="settings-panel__body">
              <div className="settings-card-grid">
                <SettingsCard
                  icon="⚙️"
                  title="General"
                  subtitle="Model, theme, font size"
                  onClick={() => setActiveModal('general')}
                />
                <SettingsCard
                  icon="🤖"
                  title="AI Behavior"
                  subtitle="Detail, tone, format"
                  onClick={() => setActiveModal('ai-behavior')}
                />
                <SettingsCard
                  icon="🧠"
                  title="Memory"
                  subtitle={`${activeMemories} fact${activeMemories !== 1 ? 's' : ''}`}
                  subtitleColor={activeMemories > 0 ? 'var(--accent-primary)' : undefined}
                  onClick={() => setActiveModal('memory')}
                />
                <SettingsCard
                  icon="🛠️"
                  title="Skills"
                  subtitle={`${activeSkills} active`}
                  subtitleColor={activeSkills > 0 ? 'var(--accent-primary)' : undefined}
                  onClick={() => setActiveModal('skills')}
                />
                <SettingsCard
                  icon="📦"
                  title="Archived Chats"
                  subtitle={`${archivedCount} chat${archivedCount !== 1 ? 's' : ''} archived`}
                  onClick={() => setActiveModal('archived')}
                />
              </div>

              <AnimatePresence>
                {activeModal === 'general' && (
                  <SettingsModal title="⚙️ General" onClose={closeModal}>
                    <div className="settings-modal-section">
                      <div className="settings-modal-label">Default Model</div>
                      <ModelSelection
                        models={models}
                        defaultModel={settings.defaultModel}
                        onDefaultModelChange={(model) => onSettingsChange({ defaultModel: model })}
                      />
                    </div>
                    <div className="settings-modal-section">
                      <div className="settings-modal-label">Theme</div>
                      <div className="settings-pill-group">
                        <button
                          className={`settings-pill${theme === 'dark' ? ' settings-pill--active' : ''}`}
                          onClick={() => theme !== 'dark' && toggleTheme()}
                        >
                          🌙 Dark
                        </button>
                        <button
                          className={`settings-pill${theme === 'light' ? ' settings-pill--active' : ''}`}
                          onClick={() => theme !== 'light' && toggleTheme()}
                        >
                          ☀️ Light
                        </button>
                      </div>
                    </div>
                    <div className="settings-modal-section">
                      <div className="settings-modal-label">Animation Intensity</div>
                      <div className="settings-pill-group">
                        {(['subtle', 'normal', 'intense'] as AnimationIntensity[]).map((level) => (
                          <button
                            key={level}
                            className={`settings-pill${animationIntensity === level ? ' settings-pill--active' : ''}`}
                            onClick={() => setAnimationIntensity(level)}
                          >
                            {level.charAt(0).toUpperCase() + level.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="settings-modal-section">
                      <div className="settings-modal-label">Font Size: {fontSize}px</div>
                      <div className="settings-slider-row">
                        <span className="settings-slider-min">12</span>
                        <input
                          type="range"
                          min="12"
                          max="22"
                          value={fontSize}
                          onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
                          className="settings-slider"
                        />
                        <span className="settings-slider-max">22</span>
                      </div>
                    </div>
                  </SettingsModal>
                )}

                {activeModal === 'ai-behavior' && (
                  <SettingsModal title="🤖 AI Behavior" onClose={closeModal}>
                    <div className="settings-modal-section">
                      <div className="settings-modal-label">Additional details used to decide how the model should behave</div>
                      <SystemPromptEditor value={systemPrompt} onChange={onSystemPromptChange} />
                    </div>
                    <div className="settings-modal-section">
                      <AIPreferences
                        preferences={settings.preferences}
                        onPreferenceChange={onPreferenceChange}
                        onReset={() => {
                          const keys: (keyof UserPreferencesType)[] = [
                            'responseDetail', 'technicalLevel', 'responseFormat',
                            'domains', 'personality', 'proactiveness',
                            'languageStyle', 'useOfExamples',
                          ];
                          keys.forEach((key) => onPreferenceChange(key, null));
                        }}
                      />
                    </div>
                    <div className="settings-modal-section">
                      <ContextSettings
                        contextWindowSize={settings.contextWindowSize}
                        onContextWindowSizeChange={(size) => onSettingsChange({ contextWindowSize: size })}
                        autoExtractMemory={settings.autoExtractMemory}
                        onAutoExtractMemoryChange={(enabled) => onSettingsChange({ autoExtractMemory: enabled })}
                      />
                    </div>
                    <button
                      className="settings-modal-reset-btn"
                      onClick={() => {
                        const keys: (keyof UserPreferencesType)[] = [
                          'responseDetail', 'technicalLevel', 'responseFormat',
                          'domains', 'personality', 'proactiveness',
                          'languageStyle', 'useOfExamples',
                        ];
                        keys.forEach((key) => onPreferenceChange(key, null));
                      }}
                    >
                      Reset to Defaults
                    </button>
                  </SettingsModal>
                )}

                {activeModal === 'memory' && (
                  <SettingsModal title="🧠 Memory" onClose={closeModal}>
                    <MemoryManager
                      memories={memories}
                      onAdd={onAddMemory}
                      onUpdate={onUpdateMemory}
                      onDelete={onDeleteMemory}
                    />
                  </SettingsModal>
                )}

                {activeModal === 'skills' && (
                  <SettingsModal title="🛠️ Skills" onClose={closeModal}>
                    <SkillsManager
                      skills={skills}
                      onToggle={onToggleSkill}
                      onDelete={onDeleteSkill}
                      onAdd={onAddSkill}
                    />
                  </SettingsModal>
                )}

                {activeModal === 'archived' && (
                  <SettingsModal title="📦 Archived Chats" onClose={closeModal}>
                    <ArchivedChats
                      conversations={conversations}
                      onSelect={(id) => { onSelectConversation(id); onClose(); }}
                      onUnarchive={onUnarchiveConversation}
                      onDelete={onDeleteConversation}
                    />
                  </SettingsModal>
                )}
              </AnimatePresence>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Add settings-panel card-grid and modal-section CSS, update panel width**

In `src/styles/global.css`, make these changes:

1. Change `.settings-panel` width from `320px` to `400px`
2. Change the `.settings-panel` `initial` animation x value (handled in component, already 400)
3. Remove `.settings-section__title` style block
4. Add these new styles after `.settings-panel__body`:

```css
.settings-card-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.settings-card-grid > .settings-card:last-child {
  grid-column: 1 / -1;
}

.settings-modal-section {
  margin-bottom: 20px;
}

.settings-modal-label {
  font-size: 11px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.settings-pill-group {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.settings-pill {
  padding: 8px 16px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-tertiary);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  transition: border-color 0.15s, color 0.15s;
}

.settings-pill:hover {
  border-color: var(--accent-primary);
  color: var(--text-secondary);
}

.settings-pill--active {
  border-color: var(--accent-primary);
  color: var(--accent-primary);
  font-weight: 600;
}

.settings-slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.settings-slider-min,
.settings-slider-max {
  font-size: 10px;
  color: var(--text-tertiary);
}

.settings-slider {
  flex: 1;
  accent-color: var(--accent-primary);
}

.settings-modal-reset-btn {
  width: 100%;
  padding: 8px 16px;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-tertiary);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  transition: border-color 0.15s, color 0.15s;
}

.settings-modal-reset-btn:hover {
  border-color: var(--accent-primary);
  color: var(--text-secondary);
}
```

- [ ] **Step 3: Delete SettingsSection.tsx**

```bash
rm src/components/settings/SettingsSection.tsx
```

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/SettingsPanel.tsx src/styles/global.css
git rm src/components/settings/SettingsSection.tsx
git commit -m "feat: rewrite SettingsPanel with card grid + modals layout"
```

---

### Task 7: Update ChatLayout and remaining references

**Files:**
- Modify: `src/components/chat/ChatLayout.tsx`

- [ ] **Step 1: Verify ChatLayout passes correct props**

The `ChatLayout.tsx` file already passes all required props to `SettingsPanel`. The only change is that `SettingsPanel` no longer imports `SettingsSection`, so no changes needed in ChatLayout. Verify the app compiles.

- [ ] **Step 2: Build and verify**

```bash
cd /c/Users/abhir/Desktop/claude && npm run build 2>&1 | head -30
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit any fixes if needed, otherwise skip**

---

### Task 8: Visual verification and cleanup

**Files:**
- Modify: `src/styles/global.css` (cleanup)
- Modify: `src/components/settings/UserPreferences.tsx` (remove, replaced by General modal)

- [ ] **Step 1: Remove unused UserPreferences component imports**

The `UserPreferences` component is no longer imported by `SettingsPanel`. Delete it since its functionality is now handled directly inside the General modal (theme pills, animation pills, font slider).

```bash
rm src/components/settings/UserPreferences.tsx
```

- [ ] **Step 2: Remove unused styles**

Remove any leftover `.user-preferences__*` styles from `src/styles/global.css` if present.

- [ ] **Step 3: Remove leftover `.settings-section__title` if still present**

Verify `.settings-section__title` is removed from `global.css`.

- [ ] **Step 4: Start dev server and verify in browser**

```bash
cd /c/Users/abhir/Desktop/claude && npm run dev
```

Verify:
1. Settings panel opens at 400px width
2. Card grid shows 5 cards (4 in 2-col grid, 1 full-width Archived Chats)
3. Clicking each card opens a centered modal with correct content
4. Escape or ✕ closes modal, returns to card grid
5. Memory items show ⋮ menu with Edit/Deactivate/Delete
6. Skills items show ⋮ menu with Activate/Deactivate/Delete
7. General modal has model dropdown, theme pills, animation pills, font slider
8. AI Behavior modal has system prompt, preferences, context settings, reset button

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: cleanup unused components and styles after settings restructure"
```