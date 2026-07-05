import { useState, useEffect } from 'react';
import type { AppSettings, OllamaModel } from '../../hooks/useSettings';
import { ModelSelection } from './ModelSelection';
import { useTheme } from '../../hooks/useTheme';
import type { AnimationIntensity } from '../../hooks/useTheme';
import { Tooltip } from '../shared/Tooltip';
import { CustomSelect } from './CustomSelect';
import { EDITOR_THEMES } from '../../utils/editorThemes';

interface SettingsPanelProps {
  settings: AppSettings;
  models: OllamaModel[];
  onSettingsChange: (updates: Partial<AppSettings>) => void;
}

export function SettingsPanel({
  settings,
  models,
  onSettingsChange,
}: SettingsPanelProps) {
  const [defaultProjectPathInput, setDefaultProjectPathInput] = useState(settings.defaultProjectPath ?? '')
  const [ollamaUrlInput, setOllamaUrlInput] = useState(settings.ollamaBaseUrl ?? '')
  const [ollamaTestResult, setOllamaTestResult] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [ollamaTestError, setOllamaTestError] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState(settings.ollamaApiKey ?? '')
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [apiKeyTestResult, setApiKeyTestResult] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [apiKeyTestError, setApiKeyTestError] = useState('')
  const { animationIntensity, setAnimationIntensity } = useTheme();

  useEffect(() => {
    setDefaultProjectPathInput(settings.defaultProjectPath ?? '')
  }, [settings.defaultProjectPath])

  useEffect(() => {
    setOllamaUrlInput(settings.ollamaBaseUrl ?? '')
  }, [settings.ollamaBaseUrl])

  useEffect(() => {
    setApiKeyInput(settings.ollamaApiKey ?? '')
  }, [settings.ollamaApiKey])

  const stripQuotes = (path: string) => path.replace(/^["'](.+)["']$/, '$1');

  return (
    <div className="settings-view">
      <div className="settings-view__grid">
        {/* ── Ollama URL ── */}
        <div className="settings-view__card settings-view__card--wide">
          <div className="settings-view__card-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            Ollama URL
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

        {/* ── API Key ── */}
        <div className="settings-view__card settings-view__card--wide">
          <div className="settings-view__card-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            API Key
            <Tooltip content="API key for Ollama cloud web search (free tier: 100 searches/day). Get yours at ollama.com/settings/keys" position="top">
              <span className="help-icon">?</span>
            </Tooltip>
          </div>
          <div className="ollama-url-input-wrapper">
            <input
              className="folder-picker__input"
              type={apiKeyVisible ? 'text' : 'password'}
              autoComplete="off"
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
          {settings.ollamaApiKey || apiKeyInput.trim() ? (
            <span className="ollama-url-feedback" style={{ color: 'var(--accent-primary, #4ade80)' }}>
              ✓ Key configured
            </span>
          ) : settings.hasEnvApiKey ? (
            <span className="ollama-url-feedback" style={{ color: 'var(--accent-primary, #4ade80)' }}>
              ✓ Using environment key
            </span>
          ) : (
            <span className="ollama-url-feedback" style={{ color: 'var(--text-muted, #888)' }}>
              ✗ No key set — web search will be limited
            </span>
          )}
          {apiKeyTestResult === 'success' && <span className="ollama-url-feedback ollama-url-feedback--success">Key valid</span>}
          {apiKeyTestResult === 'error' && <span className="ollama-url-feedback ollama-url-feedback--error">{apiKeyTestError || 'Invalid key'}</span>}
        </div>

        {/* ── Context Window ── */}
        <div className="settings-view__card settings-view__card--wide">
          <div className="settings-view__card-label">Context Window</div>
          <div className="context-settings__header">
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
                const markers = [131072, 262144, 524288, 1048576]
                const snapped = markers.find(m => Math.abs(raw - m) / m < 0.1)
                onSettingsChange({ contextWindowSize: snapped || raw })
              }}
              className="context-settings__range"
              style={{
                background: `linear-gradient(to right, rgba(0, 240, 255, 0.5) ${Math.round(Math.log(settings.contextWindowSize / 131072) / Math.log(1048576 / 131072) * 100)}%, rgba(0, 240, 255, 0.12) ${Math.round(Math.log(settings.contextWindowSize / 131072) / Math.log(1048576 / 131072) * 100)}%)`
              }}
            />
          </div>
          <div className="context-settings__markers">
            <span className="context-settings__marker">128K</span>
            <span className="context-settings__marker">256K</span>
            <span className="context-settings__marker">512K</span>
            <span className="context-settings__marker">1M</span>
          </div>
        </div>

        {/* ── Project Model ── */}
        <div className="settings-view__card">
          <div className="settings-view__card-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            Project Model
            <Tooltip content="AI model used for building projects — generating names, writing code, and all project tasks." position="top">
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

        {/* ── Embedding Model ── */}
        <div className="settings-view__card">
          <div className="settings-view__card-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            Embedding Model
            <Tooltip content="Model used for code search and context generation." position="top">
              <span className="help-icon">?</span>
            </Tooltip>
          </div>
          <ModelSelection
            models={models.filter(m => m.isEmbedding)}
            defaultModel={settings.defaultEmbeddingModel ?? ''}
            onDefaultModelChange={(model) => onSettingsChange({ defaultEmbeddingModel: model || null })}
          />
        </div>

        {/* ── Vision Model ── */}
        <div className="settings-view__card">
          <div className="settings-view__card-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            Vision Model
            <Tooltip content="Model for image understanding. Leave empty to use the project model." position="top">
              <span className="help-icon">?</span>
            </Tooltip>
          </div>
          <ModelSelection
            models={models}
            defaultModel={settings.defaultVisionModel ?? ''}
            onDefaultModelChange={(model) => onSettingsChange({ defaultVisionModel: model || null })}
            filterEmbedding
            allowEmpty
            emptyLabel="None (use project model)"
          />
        </div>

        {/* ── Auto-Save ── */}
        <div className="settings-view__card settings-view__card--compact">
          <div className="settings-view__card-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            Auto-Save
            <Tooltip content="Automatically save files after a short delay when changes are made." position="top">
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

        {/* ── Editor Theme ── */}
        <div className="settings-view__card">
          <div className="settings-view__card-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            Editor Theme
            <Tooltip content="Syntax highlighting theme for the workspace code editor." position="top">
              <span className="help-icon">?</span>
            </Tooltip>
          </div>
          <CustomSelect
            options={EDITOR_THEMES.map(t => ({ value: t.key, label: t.label }))}
            value={settings.codeEditorTheme}
            onChange={(value) => onSettingsChange({ codeEditorTheme: value })}
          />
        </div>

        {/* ── Project Path ── */}
        <div className="settings-view__card">
          <div className="settings-view__card-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            Project Path
            <Tooltip content="AURA creates project directories inside this folder. Set once to skip the folder picker." position="top">
              <span className="help-icon">?</span>
            </Tooltip>
          </div>
          <div className="folder-picker__input-group" style={{ marginBottom: '8px' }}>
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
              Save
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

        {/* ── Animation ── */}
        <div className="settings-view__card settings-view__card--compact">
          <div className="settings-view__card-label">Animation</div>
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

        {/* ── Coffee ── */}
        <a
          className="settings-view__card settings-view__card--compact settings-view__card--coffee"
          href="https://buymeacoffee.com/sno0p3r"
          target="_blank"
          rel="noopener noreferrer"
        >
          <div className="settings-view__coffee-text">
            <span>☕ Support AURA</span>
            <span className="settings-view__coffee-link-text">Buy a Coffee →</span>
          </div>
        </a>
      </div>
    </div>
  );
}