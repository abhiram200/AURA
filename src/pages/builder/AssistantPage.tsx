import { useState, useEffect } from 'react'
import type { useAura } from '../../hooks/useAura'
import { useTheme } from '../../hooks/useTheme'
import { useManagedShells } from '../../hooks/useManagedShells'
import AuraChat from '../../components/aura/AuraChat'
import { ManagedShellBadge } from '../../components/aura/ManagedShellBadge'
import { ManagedTerminalPanel } from '../../components/aura/ManagedTerminalPanel'
import '../../styles/managed-shell.css'

interface AssistantPageProps {
  projectId: string
  projectName: string
  workspacePath: string
  conversationId: string | null
  aura: ReturnType<typeof useAura>
}

const SKIP_KEY = (pid: string) => `aura-skip-new-chat-confirm:${pid}`

export function AssistantPage({ projectId, projectName, workspacePath: _workspacePath, conversationId: _conversationId, aura }: AssistantPageProps) {
  const { theme } = useTheme()
  const isLight = theme === 'light'
  const [showConfirm, setShowConfirm] = useState(false)
  const managedShells = useManagedShells(projectId)

  // When viewing a shell, fetch its full output from the REST API
  useEffect(() => {
    if (managedShells.viewingShell) {
      managedShells.fetchShellOutput(managedShells.viewingShell)
    }
  }, [managedShells.viewingShell]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleNewChat = () => {
    const skip = localStorage.getItem(SKIP_KEY(projectId)) === 'true'
    if (skip || aura.chatMessages.length === 0) {
      aura.startNewChat()
    } else {
      setShowConfirm(true)
    }
  }

  const confirmNewChat = (skipNext: boolean) => {
    if (skipNext) {
      localStorage.setItem(SKIP_KEY(projectId), 'true')
    }
    aura.startNewChat()
    setShowConfirm(false)
  }

  const usage = aura.contextUsagePercent
  const barColor = usage < 60
    ? (isLight ? '#22c55e' : '#4ade80')
    : usage < 80
      ? (isLight ? '#eab308' : '#facc15')
      : (isLight ? '#ef4444' : '#f87171')

  return (
    <div
      className="assistant-page"
      style={{
        '--assistant-bg': isLight ? '#ffffff' : 'var(--bg-primary)',
        '--assistant-sidebar': isLight ? '#f6f8fa' : 'var(--bg-secondary)',
        '--assistant-fg': isLight ? '#1a1a2e' : 'var(--text-primary)',
        '--assistant-muted': isLight ? '#666' : 'var(--text-tertiary)',
        '--assistant-border': isLight ? '#d0d0d0' : 'var(--border-color)',
        '--assistant-input-bg': isLight ? '#f0f0f0' : 'var(--bg-input)',
        '--assistant-user-bg': isLight ? '#e0e8f0' : '#1a3a1a',
        '--assistant-code-bg': isLight ? '#f5f5f5' : 'var(--code-bg)',
      } as React.CSSProperties}
    >
      <div className="assistant-page__header">
        <div className="assistant-page__brand">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a8 8 0 0 0-8 8c0 3.4 2.1 6.3 5 7.5V20h6v-2.5c2.9-1.2 5-4.1 5-7.5a8 8 0 0 0-8-8z" />
            <path d="M9 20h6M10 22h4" />
          </svg>
          <span>AURA AI</span>
          <span className="assistant-page__project-name">{projectName}</span>
        </div>
        <div className="assistant-page__context-bar">
          <div className="assistant-page__context-bar-track">
            <div
              className="assistant-page__context-bar-fill"
              style={{ width: `${usage}%`, background: `linear-gradient(90deg, ${isLight ? '#4ade80' : '#22c55e'}, ${barColor})` }}
            />
          </div>
          <span className="assistant-page__context-bar-label">{usage}% used</span>
        </div>
        <ManagedShellBadge
          activeShells={managedShells.activeShells}
          allShells={managedShells.allShells}
          onViewShell={managedShells.setViewingShell}
          onTerminateShell={managedShells.terminateShell}
          onDismissShell={managedShells.dismissShell}
        />
        <button className="assistant-page__new-chat-btn" onClick={handleNewChat} title="New chat">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
      <AuraChat
        messages={aura.chatMessages}
        isStreaming={aura.isStreaming}
        error={aura.chatError}
        onAsk={(prompt) => aura.ask(prompt, managedShells.handleShellEvent)}
        onClearError={aura.clearChatError}
        pendingApproval={aura.pendingApproval}
        onRespondToApproval={aura.respondToApproval}
        onViewShell={managedShells.setViewingShell}
      />
      {managedShells.viewingShell && (() => {
        const shell = managedShells.shells.get(managedShells.viewingShell)
        if (!shell) return null
        return (
          <ManagedTerminalPanel
            shell={shell}
            onDismiss={managedShells.dismissShell}
            onTerminate={managedShells.terminateShell}
            onClose={managedShells.closeShellPanel}
            isLight={theme === 'light'}
          />
        )
      })()}
      {showConfirm && (
        <div className="assistant-confirm-overlay" onClick={() => setShowConfirm(false)}>
          <div className="assistant-confirm-dialog" onClick={e => e.stopPropagation()}>
            <p className="assistant-confirm-dialog__title">Start new chat?</p>
            <p className="assistant-confirm-dialog__text">This will delete your current conversation.</p>
            <label className="assistant-confirm-dialog__skip">
              <input type="checkbox" id="skip-new-chat-confirm" />
              Don't show this again for this project
            </label>
            <div className="assistant-confirm-dialog__actions">
              <button className="assistant-confirm-dialog__btn assistant-confirm-dialog__btn--cancel" onClick={() => setShowConfirm(false)}>Cancel</button>
              <button className="assistant-confirm-dialog__btn assistant-confirm-dialog__btn--confirm" onClick={() => {
                const skip = (document.getElementById('skip-new-chat-confirm') as HTMLInputElement).checked
                confirmNewChat(skip)
              }}>New Chat</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}