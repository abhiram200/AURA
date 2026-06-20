import { useState, useEffect } from 'react';
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
import { MemoryManager } from './MemoryManager';
import { SkillsManager } from './SkillsManager';
import { ArchivedChats } from './ArchivedChats';
import { useTheme } from '../../hooks/useTheme';
import type { AnimationIntensity } from '../../hooks/useTheme';
import { getTransition } from '../../hooks/useAnimationConfig';
import { Tooltip } from '../shared/Tooltip';
import { EDITOR_THEMES } from '../../utils/editorThemes';

type ModalType = 'general' | 'preferences' | 'projects' | 'memory' | 'skills' | 'archived' | 'chats' | null;

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
  onDeleteAllMemories: () => void;
  onRefreshMemories: () => void;
  skills: SkillEntry[];
  onToggleSkill: (id: string, active: boolean) => void;
  onDeleteSkill: (id: string, force?: boolean) => void;
  onDeleteAllSkills: () => void;
  onRefreshSkills: () => void;
  onAddSkill: (definition: SkillEntry['definition'], handler: SkillEntry['handler']) => void;
  onLockSkill: (id: string, locked: boolean) => void;
  onEditSkill: (skill: SkillEntry) => void;
  onUpdateSkill: (id: string, updates: { definition?: SkillEntry['definition']; handler?: SkillEntry['handler'] }) => Promise<SkillEntry | null>;
  onOpenPlayground: () => void;
  conversations: ConversationSummary[];
  onSelectConversation: (id: string) => void;
  onUnarchiveConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onDeleteAllArchived: () => void;
  onDeleteAllConversations: () => void;
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
  onDeleteAllMemories,
  onRefreshMemories,
  skills,
  onToggleSkill,
  onDeleteSkill,
  onDeleteAllSkills,
  onRefreshSkills,
  onAddSkill,
  onLockSkill,
  onEditSkill,
  onUpdateSkill,
  onOpenPlayground,
  conversations,
  onSelectConversation,
  onUnarchiveConversation,
  onDeleteConversation,
  onDeleteAllArchived,
  onDeleteAllConversations,
}: SettingsPanelProps) {
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [defaultProjectPathInput, setDefaultProjectPathInput] = useState(settings.defaultProjectPath ?? '')
  const [ollamaUrlInput, setOllamaUrlInput] = useState(settings.ollamaBaseUrl ?? '')
  const [ollamaTestResult, setOllamaTestResult] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [ollamaTestError, setOllamaTestError] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState(settings.ollamaApiKey ?? '')
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [apiKeyTestResult, setApiKeyTestResult] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [apiKeyTestError, setApiKeyTestError] = useState('')
  const { theme, toggleTheme, animationIntensity, setAnimationIntensity } = useTheme();

  useEffect(() => {
    setDefaultProjectPathInput(settings.defaultProjectPath ?? '')
  }, [settings.defaultProjectPath])

  useEffect(() => {
    setOllamaUrlInput(settings.ollamaBaseUrl ?? '')
  }, [settings.ollamaBaseUrl])

  useEffect(() => {
    setApiKeyInput(settings.ollamaApiKey ?? '')
  }, [settings.ollamaApiKey])

  const slideTransition = getTransition({ type: 'spring', stiffness: 300, damping: 30 }, animationIntensity);

  const activeMemories = memories.filter((m) => m.active).length;
  const activeSkills = skills.filter((s) => s.active).length;
  const archivedCount = conversations.filter((c) => c.archived).length;
  const activeChatCount = conversations.filter((c) => !c.archived).length;

  const closeModal = () => setActiveModal(null);

  const stripQuotes = (path: string) => path.replace(/^["'](.+)["']$/, '$1');

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="settings-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={getTransition(0.2, animationIntensity)}
            onClick={onClose}
          />
          <motion.aside
            className="settings-panel"
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            transition={slideTransition}
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
                  subtitle="Model, theme, animation"
                  onClick={() => setActiveModal('general')}
                />
                <SettingsCard
                  icon="🤖"
                  title="User Preferences"
                  subtitle="Detail, tone, format"
                  onClick={() => setActiveModal('preferences')}
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
                  icon="📁"
                  title="Projects"
                  subtitle="Path & model"
                  onClick={() => setActiveModal('projects')}
                />
                <SettingsCard
                  icon="🔬"
                  title="Skill Playground"
                  subtitle="Build, test & save skills"
                  onClick={onOpenPlayground}
                />
                <SettingsCard
                  icon="📦"
                  title="Archived Chats"
                  subtitle={`${archivedCount} chat${archivedCount !== 1 ? 's' : ''} archived`}
                  onClick={() => setActiveModal('archived')}
                />
                <SettingsCard
                  icon="💬"
                  title="Chat Management"
                  subtitle={`${activeChatCount} active chat${activeChatCount !== 1 ? 's' : ''}`}
                  onClick={() => setActiveModal('chats')}
                />
                <a
                  className="settings-card settings-card--link"
                  href="https://buymeacoffee.com/sno0p3r"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ gridColumn: 'span 2' }}
                >
                  <div className="settings-card__icon">☕</div>
                  <div className="settings-card__title">Buy me a Coffee</div>
                  <div className="settings-card__subtitle">Support the project</div>
                </a>
              </div>

              <AnimatePresence>
                {activeModal === 'general' && (
                  <SettingsModal title="⚙️ General" onClose={closeModal}>
                    <div className="settings-modal-section">
                      <div className="settings-modal-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        Ollama Base URL
                        <Tooltip content="URL of your Ollama instance. Accepts any URL or raw IP:port (e.g. 192.168.1.50:11434). Leave empty to use http://localhost:11434." position="top">
                          <span className="help-icon">?</span>
                        </Tooltip>
                      </div>
                      <div className="ollama-url-input-wrapper">
                        <input
                          className="folder-picker__input"
                          type="text"
                          value={ollamaUrlInput}
                          onChange={(e) => { setOllamaUrlInput(e.target.value); setOllamaTestResult('idle'); setOllamaTestError('') }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const btn = e.currentTarget.parentElement?.querySelector('.ollama-url-test-btn') as HTMLButtonElement | null
                              btn?.click()
                            }
                          }}
                          placeholder="http://localhost:11434"
                        />
                        <button
                          className={`ollama-url-test-btn${ollamaTestResult === 'testing' ? ' ollama-url-test-btn--testing' : ''}`}
                          disabled={ollamaTestResult === 'testing'}
                          onClick={async () => {
                            const raw = ollamaUrlInput.trim()
                            if (!raw) {
                              setOllamaTestResult('error')
                              setOllamaTestError('Enter a URL to test')
                              return
                            }
                            const normalized = !/^https?:\/\//i.test(raw) ? `http://${raw}` : raw
                            setOllamaTestResult('testing')
                            setOllamaTestError('')
                            try {
                              const res = await fetch('/api/settings/test-ollama', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ url: normalized }),
                              })
                              if (!res.ok) throw new Error(`Server error: ${res.status}`)
                              const data = await res.json()
                              if (data.ok) {
                                setOllamaTestResult('success')
                                setOllamaTestError('')
                                onSettingsChange({ ollamaBaseUrl: normalized })
                              } else {
                                setOllamaTestResult('error')
                                setOllamaTestError(data.error || 'Connection failed')
                                onSettingsChange({ ollamaBaseUrl: '' })
                              }
                            } catch (err) {
                              setOllamaTestResult('error')
                              setOllamaTestError(err instanceof Error ? err.message : 'Connection failed')
                              onSettingsChange({ ollamaBaseUrl: '' })
                            }
                          }}
                          title="Test connection & save"
                        >
                          {ollamaTestResult === 'testing' ? '' : '↗'}
                        </button>
                      </div>
                      {ollamaTestResult === 'success' && <span className="ollama-url-feedback ollama-url-feedback--success">Connected</span>}
                      {ollamaTestResult === 'error' && <span className="ollama-url-feedback ollama-url-feedback--error">{ollamaTestError || 'Connection failed'}</span>}
                    </div>
                    <div className="settings-modal-section">
                      <div className="settings-modal-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        Ollama API Key
                        <Tooltip content="API key for Ollama cloud web search (free tier: 100 searches/day). Get yours at ollama.com/settings/keys" position="top">
                          <span className="help-icon">?</span>
                        </Tooltip>
                      </div>
                      <div className="ollama-url-input-wrapper">
                        <input
                          className="folder-picker__input"
                          type={apiKeyVisible ? 'text' : 'password'}
                          value={apiKeyInput}
                          onChange={(e) => {
                            setApiKeyInput(e.target.value)
                            setApiKeyTestResult('idle')
                            setApiKeyTestError('')
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              onSettingsChange({ ollamaApiKey: apiKeyInput })
                            }
                          }}
                          placeholder="Leave empty to use .env key"
                        />
                        <button
                          className="ollama-url-test-btn"
                          onClick={() => setApiKeyVisible(!apiKeyVisible)}
                          title={apiKeyVisible ? 'Hide key' : 'Show key'}
                          style={{ fontSize: '14px', minWidth: '32px' }}
                        >
                          {apiKeyVisible ? '🙈' : '👁️'}
                        </button>
                        <button
                          className={`ollama-url-test-btn${apiKeyTestResult === 'testing' ? ' ollama-url-test-btn--testing' : ''}`}
                          disabled={apiKeyTestResult === 'testing' || !apiKeyInput.trim()}
                          onClick={async () => {
                            const key = apiKeyInput.trim()
                            if (!key) return
                            setApiKeyTestResult('testing')
                            setApiKeyTestError('')
                            try {
                              const res = await fetch('/api/settings/test-api-key', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ apiKey: key }),
                              })
                              if (!res.ok) throw new Error(`Server error: ${res.status}`)
                              const data = await res.json()
                              if (data.valid) {
                                setApiKeyTestResult('success')
                                setApiKeyTestError('')
                                onSettingsChange({ ollamaApiKey: key })
                              } else {
                                setApiKeyTestResult('error')
                                setApiKeyTestError(data.error || 'Invalid API key')
                              }
                            } catch (err) {
                              setApiKeyTestResult('error')
                              setApiKeyTestError(err instanceof Error ? err.message : 'Test failed')
                            }
                          }}
                          title="Test key & save"
                        >
                          {apiKeyTestResult === 'testing' ? '' : '↗'}
                        </button>
                      </div>
                      {!apiKeyInput.trim() && settings.ollamaApiKey ? (
                        <span className="ollama-url-feedback" style={{ color: 'var(--accent-primary, #4ade80)' }}>
                          ✓ Key configured (from .env)
                        </span>
                      ) : apiKeyInput.trim() ? (
                        <span className="ollama-url-feedback" style={{ color: 'var(--accent-primary, #4ade80)' }}>
                          ✓ Key configured
                        </span>
                      ) : (
                        <span className="ollama-url-feedback" style={{ color: 'var(--text-muted, #888)' }}>
                          ✗ No key set — web search will be limited
                        </span>
                      )}
                      {apiKeyTestResult === 'success' && <span className="ollama-url-feedback ollama-url-feedback--success">Key valid</span>}
                      {apiKeyTestResult === 'error' && <span className="ollama-url-feedback ollama-url-feedback--error">{apiKeyTestError || 'Invalid key'}</span>}
                    </div>
                    <div className="settings-modal-section">
                      <div className="settings-modal-label">Default Model</div>
                      <ModelSelection
                        models={models}
                        defaultModel={settings.defaultModel}
                        onDefaultModelChange={(model) => onSettingsChange({ defaultModel: model })}
                        filterEmbedding
                      />
                    </div>
                    <div className="settings-modal-section">
                      <div className="settings-modal-label">Auto-Extract Memory</div>
                      <div className="settings-pill-group">
                        <button
                          className={`settings-pill${settings.autoExtractMemory ? ' settings-pill--active' : ''}`}
                          onClick={() => onSettingsChange({ autoExtractMemory: true })}
                        >
                          On
                        </button>
                        <button
                          className={`settings-pill${!settings.autoExtractMemory ? ' settings-pill--active' : ''}`}
                          onClick={() => onSettingsChange({ autoExtractMemory: false })}
                        >
                          Off
                        </button>
                      </div>
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
                      <div className="context-settings__header">
                        <label className="settings-modal-label">
                          Context Window
                        </label>
                        <span className="context-settings__value">{settings.contextWindowSize >= 1048576 ? `${(settings.contextWindowSize / 1048576).toFixed(settings.contextWindowSize % 1048576 === 0 ? 0 : 1)}M` : settings.contextWindowSize >= 1024 ? `${(settings.contextWindowSize / 1024).toFixed(settings.contextWindowSize % 1024 === 0 ? 0 : 1)}K` : settings.contextWindowSize}</span>
                      </div>
                      <div className="context-settings__slider-row">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={Math.round(Math.log(settings.contextWindowSize / 131072) / Math.log(1048576 / 131072) * 100)}
                          onChange={(e) => {
                            const t = parseInt(e.target.value, 10) / 100
                            const raw = Math.round(131072 * Math.pow(1048576 / 131072, t))
                            // Snap to nearest marker if within ~10% threshold
                            const markers = [131072, 262144, 524288, 1048576]
                            const snapped = markers.find(m => Math.abs(raw - m) / m < 0.1)
                            onSettingsChange({ contextWindowSize: snapped || raw })
                          }}
                          className="context-settings__range"
                        />
                      </div>
                      <div className="context-settings__markers">
                        <span className="context-settings__marker" style={{ left: '0%' }}>128K</span>
                        <span className="context-settings__marker" style={{ left: `${Math.round(Math.log(262144 / 131072) / Math.log(1048576 / 131072) * 100)}%` }}>256K</span>
                        <span className="context-settings__marker" style={{ left: `${Math.round(Math.log(524288 / 131072) / Math.log(1048576 / 131072) * 100)}%` }}>512K</span>
                        <span className="context-settings__marker" style={{ left: '100%' }}>1M</span>
                      </div>
                    </div>
                  </SettingsModal>
                )}

                {activeModal === 'projects' && (
                  <SettingsModal title="📁 Projects" onClose={closeModal}>
                    <div className="settings-modal-section">
                      <div className="settings-modal-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        Default Project Model
                        <Tooltip content="AI model used for building projects in project mode — generating names, writing code, and all project tasks. Falls back to the default conversation model if not set." position="top">
                          <span className="help-icon">?</span>
                        </Tooltip>
                      </div>
                      <ModelSelection
                        models={models}
                        defaultModel={settings.defaultProjectModel ?? ''}
                        onDefaultModelChange={(model) => onSettingsChange({ defaultProjectModel: model || null })}
                        filterEmbedding
                      />
                    </div>
                    <div className="settings-modal-section">
                      <div className="settings-modal-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        Default Embedding Model
                        <Tooltip content="Embedding model used by AURA for code search and context generation." position="top">
                          <span className="help-icon">?</span>
                        </Tooltip>
                      </div>
                      <ModelSelection
                        models={models.filter(m => m.isEmbedding)}
                        defaultModel={settings.defaultEmbeddingModel ?? ''}
                        onDefaultModelChange={(model) => onSettingsChange({ defaultEmbeddingModel: model || null })}
                      />
                    </div>
                    <div className="settings-modal-section">
                      <div className="settings-modal-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        Code Editor Theme
                        <Tooltip content="Syntax highlighting theme for the workspace code editor. Change it anytime from the status bar too." position="top">
                          <span className="help-icon">?</span>
                        </Tooltip>
                      </div>
                      <select
                        className="settings-select"
                        value={settings.codeEditorTheme}
                        onChange={(e) => onSettingsChange({ codeEditorTheme: e.target.value })}
                      >
                        {EDITOR_THEMES.map((t) => (
                          <option key={t.key} value={t.key}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="settings-modal-section">
                      <div className="settings-modal-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        Auto-Save
                        <Tooltip content="When enabled, files in the workspace are saved automatically after a short delay whenever you make changes." position="top">
                          <span className="help-icon">?</span>
                        </Tooltip>
                      </div>
                      <div className="settings-pill-group">
                        <button
                          className={`settings-pill${settings.autoSave ? ' settings-pill--active' : ''}`}
                          onClick={() => onSettingsChange({ autoSave: true })}
                        >
                          On
                        </button>
                        <button
                          className={`settings-pill${!settings.autoSave ? ' settings-pill--active' : ''}`}
                          onClick={() => onSettingsChange({ autoSave: false })}
                        >
                          Off
                        </button>
                      </div>
                    </div>
                    <div className="settings-modal-section">
                      <div className="settings-modal-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        Default Project Path
                        <Tooltip content="When you accept Project Mode, AURA creates a project directory inside this folder using an AI-generated name. Set this once and you'll skip the folder picker every time." position="top">
                          <span className="help-icon">?</span>
                        </Tooltip>
                      </div>
                      <div className="folder-picker__input-group" style={{ marginBottom: '12px' }}>
                        <input
                          className="folder-picker__input"
                          type="text"
                          value={defaultProjectPathInput}
                          onChange={(e) => setDefaultProjectPathInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && defaultProjectPathInput.trim()) {
                              onSettingsChange({ defaultProjectPath: stripQuotes(defaultProjectPathInput.trim()) || null })
                            }
                          }}
                          placeholder="C:\Projects"
                        />
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          className="settings-pill settings-pill--active"
                          style={{ flex: 1 }}
                          onClick={() => {
                            onSettingsChange({ defaultProjectPath: stripQuotes(defaultProjectPathInput.trim()) || null })
                          }}
                        >
                          Save Path
                        </button>
                        {settings.defaultProjectPath && (
                          <button
                            className="settings-pill"
                            style={{ flex: 1 }}
                            onClick={() => {
                              setDefaultProjectPathInput('')
                              onSettingsChange({ defaultProjectPath: null })
                            }}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                  </SettingsModal>
                )}

                {activeModal === 'preferences' && (
                  <SettingsModal title="🤖 User Preferences" onClose={closeModal}>
                    <div className="settings-modal-section">
                      <div className="settings-modal-label">Custom Instructions</div>
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
                  </SettingsModal>
                )}

                {activeModal === 'memory' && (
                  <SettingsModal title="🧠 Memory" onClose={closeModal}>
                    <MemoryManager
                      memories={memories}
                      onAdd={onAddMemory}
                      onUpdate={onUpdateMemory}
                      onDelete={onDeleteMemory}
                      onDeleteAll={onDeleteAllMemories}
                      onRefresh={onRefreshMemories}
                    />
                  </SettingsModal>
                )}

                {activeModal === 'skills' && (
                  <SettingsModal title="🛠️ Skills" onClose={closeModal}>
                    <SkillsManager
                      skills={skills}
                      onToggle={onToggleSkill}
                      onDelete={onDeleteSkill}
                      onDeleteAll={onDeleteAllSkills}
                      onAdd={onAddSkill}
                      onRefresh={onRefreshSkills}
                      onLock={onLockSkill}
                      onEditSkill={onEditSkill}
                      onUpdateSkill={onUpdateSkill}
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
                      onDeleteAll={onDeleteAllArchived}
                    />
                  </SettingsModal>
                )}

                {activeModal === 'chats' && (
                  <SettingsModal title="💬 Chat Management" onClose={closeModal}>
                    <div className="settings-modal-section">
                      <div className="settings-modal-label">Active Chats</div>
                      <p className="chat-management__info">
                        {activeChatCount} active conversation{activeChatCount !== 1 ? 's' : ''} in your sidebar.
                      </p>
                    </div>
                    <button
                      className="settings-modal-reset-btn settings-modal-reset-btn--danger"
                      onClick={() => { onDeleteAllConversations(); closeModal(); }}
                    >
                      Delete All Active Chats
                    </button>
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