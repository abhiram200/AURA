import { useState } from 'react';
import type { SkillEntry } from '../../hooks/useSkills';
import { ActionMenu } from './ActionMenu';
import { Tooltip } from '../shared/Tooltip';

interface SkillsManagerProps {
  skills: SkillEntry[];
  onToggle: (id: string, active: boolean) => void;
  onDelete: (id: string, force?: boolean) => void;
  onDeleteAll: () => void;
  onAdd: (definition: SkillEntry['definition'], handler: SkillEntry['handler']) => void;
  onRefresh: () => void;
  onLock: (id: string, locked: boolean) => void;
  onEditSkill: (skill: SkillEntry) => void;
  onUpdateSkill: (id: string, updates: { definition?: SkillEntry['definition']; handler?: SkillEntry['handler'] }) => Promise<SkillEntry | null>;
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

export function SkillsManager({ skills, onToggle, onDelete, onDeleteAll, onAdd, onRefresh, onLock, onEditSkill, onUpdateSkill }: SkillsManagerProps) {
  const [showModal, setShowModal] = useState(false);
  const [jsonInput, setJsonInput] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [apiMethod, setApiMethod] = useState('POST');
  const [parseError, setParseError] = useState('');
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [testApiLoading, setTestApiLoading] = useState(false);
  const [testApiResult, setTestApiResult] = useState<{ success: boolean; status?: number; statusText?: string; body?: string; error?: string } | null>(null);
  const [editingSkill, setEditingSkill] = useState<SkillEntry | null>(null);

  const activeCount = skills.filter((s) => s.active).length;
  const inactiveCount = skills.length - activeCount;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleAdd = () => {
    setParseError('');
    try {
      const definition = JSON.parse(jsonInput);
      const handler: SkillEntry['handler'] = { type: 'api', url: apiUrl, method: apiMethod };
      if (editingSkill) {
        onUpdateSkill(editingSkill.id, { definition, handler });
      } else {
        onAdd(definition, handler);
      }
      setShowModal(false);
      setEditingSkill(null);
      setJsonInput('');
      setApiUrl('');
      setApiMethod('POST');
    } catch {
      setParseError('Invalid JSON. Please check the format and try again.');
    }
  };

  const handleCancel = () => {
    setShowModal(false);
    setEditingSkill(null);
    setJsonInput('');
    setApiUrl('');
    setApiMethod('POST');
    setParseError('');
    setTestApiResult(null);
  };

  const handleEditSkill = (skill: SkillEntry) => {
    if (skill.handler.type === 'code') {
      onEditSkill(skill);
    } else if (skill.handler.type === 'api') {
      setEditingSkill(skill);
      setJsonInput(JSON.stringify(skill.definition, null, 2));
      setApiUrl(skill.handler.url || '');
      setApiMethod(skill.handler.method || 'POST');
      setShowModal(true);
    }
  };

  const handleTestApi = async () => {
    if (!apiUrl.trim()) return;
    setTestApiLoading(true);
    setTestApiResult(null);
    try {
      const res = await fetch('/api/skills/test-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: apiUrl, method: apiMethod }),
      });
      const data = await res.json();
      setTestApiResult(data);
    } catch (err) {
      setTestApiResult({ success: false, error: 'Network error' });
    } finally {
      setTestApiLoading(false);
    }
  };

  const handleDeleteAll = () => {
    if (confirmDeleteAll) {
      onDeleteAll();
      setConfirmDeleteAll(false);
    } else {
      setConfirmDeleteAll(true);
    }
  };

  return (
    <div className="skills-manager">
      <div className="skills-manager__header">
        <div className="skills-manager__header-stats">
          <div className="skills-manager__stat-row skills-manager__stat-row--active">
            <span className="skills-manager__stat-dot skills-manager__stat-dot--active" />
            <span className="skills-manager__stat-text skills-manager__stat-text--active">{activeCount} active</span>
          </div>
          <div className="skills-manager__stat-row skills-manager__stat-row--inactive">
            <span className="skills-manager__stat-dot skills-manager__stat-dot--inactive" />
            <span className="skills-manager__stat-text skills-manager__stat-text--inactive">{inactiveCount} inactive</span>
          </div>
        </div>
        <div className="skills-manager__header-actions">
          <Tooltip content="Refresh skills">
            <button className="skills-manager__refresh-btn" onClick={onRefresh}>
              ↻
            </button>
          </Tooltip>
          {skills.length > 0 && (
            <button
              className={`skills-manager__delete-all-btn ${confirmDeleteAll ? 'skills-manager__delete-all-btn--confirm' : ''}`}
              onClick={handleDeleteAll}
              onBlur={() => setConfirmDeleteAll(false)}
            >
              {confirmDeleteAll ? 'Confirm?' : 'Delete all'}
            </button>
          )}
          <button className="skills-manager__add-btn" onClick={() => setShowModal(true)}>
            + Add Skill
          </button>
        </div>
      </div>
      {skills.length === 0 ? (
        <div className="skills-manager__empty">
          <p>No skills configured yet.</p>
          <p className="skills-manager__empty-hint">Click <strong>+ Add Skill</strong> to get started.</p>
        </div>
      ) : (
        <ul className="skills-manager__list">
          {skills.map((skill) => {
            const isBuiltin = skill.id.startsWith('builtin_');
            const typeLabel = isBuiltin ? 'Built-in' : skill.handler.type === 'api' ? 'API' : 'Custom'
            const typeClass = isBuiltin ? 'skills-manager__type--builtin' : skill.handler.type === 'api' ? 'skills-manager__type--api' : 'skills-manager__type--custom'
            return (
              <li key={skill.id} className="skills-manager__item">
                <div className="skills-manager__info">
                  <span className="skills-manager__name">
                    {skill.name}
                    {!isBuiltin && (
                      <Tooltip content={skill.locked ? 'Click to unlock' : 'Click to lock'}>
                        <button
                          className={`skills-manager__lock-toggle ${skill.locked ? 'skills-manager__lock-toggle--locked' : 'skills-manager__lock-toggle--unlocked'}`}
                          onClick={() => onLock(skill.id, !skill.locked)}
                        >
                          {skill.locked ? '🔒' : '🔓'}
                        </button>
                      </Tooltip>
                    )}
                  </span>
                  <div className="skills-manager__meta">
                    <span className={`skills-manager__type ${typeClass}`}>
                      {typeLabel}
                    </span>
                    <Tooltip content={skill.active ? 'Click to deactivate' : 'Click to activate'}>
                      <button
                        className={`skills-manager__status-btn ${skill.active ? 'skills-manager__status-btn--active' : 'skills-manager__status-btn--inactive'}`}
                        onClick={() => onToggle(skill.id, !skill.active)}
                      >
                      <span className="skills-manager__status-dot-wrapper">
                        <span className={`skills-manager__status-dot ${skill.active ? 'skills-manager__status-dot--active' : 'skills-manager__status-dot--inactive'}`} />
                        {skill.active && <span className="skills-manager__status-ripple" />}
                        {!skill.active && <span className="skills-manager__status-ripple-red" />}
                      </span>
                      {skill.active ? 'Active' : 'Inactive'}
                    </button>
                    </Tooltip>
                  </div>
                </div>
                <ActionMenu
                  items={[
                    { label: skill.active ? 'Deactivate' : 'Activate', onClick: () => onToggle(skill.id, !skill.active) },
                    ...(!isBuiltin ? [
                      { label: 'Edit', onClick: () => handleEditSkill(skill) },
                      { label: skill.locked ? 'Unlock' : 'Lock', onClick: () => onLock(skill.id, !skill.locked) },
                      { label: 'Delete', onClick: () => {
                        if (skill.locked) {
                          setConfirmDeleteId(skill.id)
                        } else {
                          onDelete(skill.id)
                        }
                      }, danger: true },
                    ] : []),
                  ]}
                />
                {confirmDeleteId === skill.id && (
                  <div className="skills-manager__confirm-delete">
                    <span>This skill is locked. Delete anyway?</span>
                    <div className="skills-manager__confirm-delete-actions">
                      <button className="skills-manager__confirm-delete-yes" onClick={() => { onDelete(skill.id, true); setConfirmDeleteId(null); }}>Delete</button>
                      <button className="skills-manager__confirm-delete-no" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {showModal && (
        <div className="skills-manager__overlay" onClick={handleCancel}>
          <div className="skills-manager__modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="skills-manager__modal-title">{editingSkill ? 'Edit Skill' : 'Add Custom Skill'}</h3>
            <p className="skills-manager__modal-hint">
              Paste a JSON function definition in OpenAI tool format.
            </p>
            <textarea
              className="skills-manager__textarea"
              value={jsonInput}
              onChange={(e) => {
                setJsonInput(e.target.value);
                setParseError('');
              }}
              placeholder={EXAMPLE_JSON}
              rows={8}
            />
            <div className="skills-manager__api-fields">
              <div className="skills-manager__handler-row">
                <label className="skills-manager__handler-label">API URL</label>
                <input
                  type="text"
                  className="skills-manager__handler-input"
                  value={apiUrl}
                  onChange={(e) => { setApiUrl(e.target.value); setTestApiResult(null); }}
                  placeholder="https://api.example.com/endpoint"
                />
                <Tooltip content="Test API connectivity">
                  <button
                    className="skills-manager__test-api-btn"
                    onClick={handleTestApi}
                    disabled={!apiUrl.trim() || testApiLoading}
                  >
                    {testApiLoading ? <span className="skills-manager__test-api-spinner" /> : '⚡'}
                  </button>
                </Tooltip>
              </div>
              {testApiResult && (
                <div className={`skills-manager__test-api-result ${testApiResult.success ? 'skills-manager__test-api-result--ok' : 'skills-manager__test-api-result--err'}`}>
                  {testApiResult.success ? (
                    <>
                      <span className="skills-manager__test-api-status">{testApiResult.status} {testApiResult.statusText}</span>
                      {testApiResult.body && (
                        <pre className="skills-manager__test-api-body">{testApiResult.body}</pre>
                      )}
                    </>
                  ) : (
                    <span>{testApiResult.error}</span>
                  )}
                </div>
              )}
              <div className="skills-manager__handler-row">
                <label className="skills-manager__handler-label">Method</label>
                <select
                  className="skills-manager__handler-select"
                  value={apiMethod}
                  onChange={(e) => { setApiMethod(e.target.value); setTestApiResult(null); }}
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                </select>
              </div>
            </div>
            {parseError && <p className="skills-manager__error">{parseError}</p>}
            <div className="skills-manager__modal-actions">
              <button className="skills-manager__cancel-btn" onClick={handleCancel}>
                Cancel
              </button>
              <button className="skills-manager__confirm-btn" onClick={handleAdd}>
                {editingSkill ? 'Save' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="skills-manager__toast">
          {toast}
        </div>
      )}
    </div>
  );
}