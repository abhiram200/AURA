import type { useAura } from '../../hooks/useAura'
import { useTheme } from '../../hooks/useTheme'
import AuraChat from '../../components/aura/AuraChat'

interface AssistantPageProps {
  projectId: string
  projectName: string
  workspacePath: string
  conversationId: string | null
  aura: ReturnType<typeof useAura>
}

export function AssistantPage({ projectId: _projectId, projectName, workspacePath: _workspacePath, conversationId: _conversationId, aura }: AssistantPageProps) {
  const { theme } = useTheme()
  const isLight = theme === 'light'

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
      </div>
      <AuraChat
        messages={aura.chatMessages}
        isStreaming={aura.isStreaming}
        isCompacting={aura.isCompacting}
        error={aura.chatError}
        onAsk={aura.ask}
        onClearError={aura.clearChatError}
      />
    </div>
  )
}