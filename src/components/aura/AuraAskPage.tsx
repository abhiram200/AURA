import type { AuraChatMessage } from '../../hooks/useAura'
import AuraChat from './AuraChat'

interface AuraAskPageProps {
  projectId: string
  projectName: string
  onBack: () => void
  ask: (prompt: string) => void
  chatMessages: AuraChatMessage[]
  isStreaming: boolean
  isCompacting: boolean
  chatError: string | null
  clearChatError: () => void
}

export function AuraAskPage({ projectName, onBack, ask, chatMessages, isStreaming, isCompacting, chatError, clearChatError }: AuraAskPageProps) {
  return (
    <div className="aura-ask-page">
      <div className="aura-ask-page__header">
        <button className="aura-ask-page__back" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Graph
        </button>
        <div className="aura-ask-page__brand">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="2" />
            <circle cx="6" cy="6" r="2" />
            <circle cx="18" cy="6" r="2" />
            <circle cx="6" cy="18" r="2" />
            <circle cx="18" cy="18" r="2" />
            <line x1="12" y1="10" x2="7" y2="7.4" />
            <line x1="12" y1="10" x2="17" y2="7.4" />
            <line x1="12" y1="14" x2="7" y2="16.6" />
            <line x1="12" y1="14" x2="17" y2="16.6" />
          </svg>
          AURA
        </div>
        <span className="aura-ask-page__project">{projectName}</span>
      </div>
      <div className="aura-ask-page__content">
        <AuraChat
          messages={chatMessages}
          isStreaming={isStreaming}
          isCompacting={isCompacting}
          error={chatError}
          onAsk={ask}
          onClearError={clearChatError}
        />
      </div>
    </div>
  )
}