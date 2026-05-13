import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Sidebar } from '../sidebar/Sidebar';
import { ChatInput } from '../input/ChatInput';
import { MessageList } from './MessageList';
import { SettingsPanel } from '../settings/SettingsPanel';
import { GlowButton } from '../shared/GlowButton';
import { ModelSelector } from './ModelSelector';
import { OnboardingModal } from './OnboardingModal';
import { MemoryNotification } from './MemoryNotification';
import { ProjectModeModal } from './ProjectModeModal';
import { GithubClonePathModal } from './GithubClonePathModal';
import { ProjectModeButton } from './ProjectModeButton';
import { Tooltip } from '../shared/Tooltip';
import { useChat, getActivePath, getSiblings } from '../../hooks/useChat';
import { useSettings } from '../../hooks/useSettings';
import { useMemory } from '../../hooks/useMemory';
import { useSkills, type SkillEntry } from '../../hooks/useSkills';
import { useServerStatus } from '../../hooks/useServerStatus';
import type { UserPreferences } from '../../hooks/useSettings';

export function ChatLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { settings, models, updateSettings, updatePreferences, loading: settingsLoading } = useSettings();

  const {
    conversations,
    activeConversation,
    activeConversationId,
    setActiveConversationId,
    sendMessage,
    isTyping,
    createConversation,
    startNewConversation,
    deleteConversation,
    deleteAllConversations,
    archiveConversation,
    unarchiveConversation,
    renameConversation,
    updateConversationModel,
    stopGeneration,
    switchBranch,
    editMessage,
    regenerateResponse,
    copyMessage,
    retryLastMessage,
    projectModeSuggested,
    existingProjectChoice,
    acceptProjectMode,
    openExistingProject,
    createNewProject,
    continueInChat,
    pendingGithubUrl,
    dismissGithubPathModal,
    retryGithubClone,
  } = useChat(settings.defaultModel);
  const { memories, addMemory, updateMemory, deleteMemory, deleteAllMemories, fetchMemories } = useMemory();
  const { skills, addSkill, updateSkill, toggleSkill, deleteSkill, deleteAllSkills, fetchSkills, lockSkill } = useSkills();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const state = location.state as { openSettings?: boolean } | null
    if (state?.openSettings) {
      setSettingsOpen(true)
      window.history.replaceState({}, '')
    }
  }, [location.state])
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [memoryFacts, setMemoryFacts] = useState<string[]>([]);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [focusTrigger, setFocusTrigger] = useState(0);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const scrollFnRef = useRef<() => void>(() => {});
  const { serverOnline, ollamaOnline } = useServerStatus();

  // Compute the active path (visible messages) from the tree
  const visibleMessages = useMemo(() => {
    if (!activeConversation) return []
    return getActivePath(activeConversation.messages, activeConversation.activeLeafId)
  }, [activeConversation])

  // Auto-collapse sidebar on mobile viewports
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setSidebarOpen(!mq.matches);
    const handler = (e: MediaQueryListEvent) => setSidebarOpen(!e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Show onboarding only when preferences haven't been set yet and settings are loaded
  useEffect(() => {
    if (!settingsLoading) {
      setShowOnboarding(!settings.preferencesSet);
    }
  }, [settings.preferencesSet, settingsLoading]);

  const handleOnboardingComplete = useCallback(
    (preferences: UserPreferences) => {
      updateSettings({ preferences, preferencesSet: true });
      setShowOnboarding(false);
    },
    [updateSettings]
  );

  const handleOnboardingSkip = useCallback(() => {
    updateSettings({ preferencesSet: true });
    setShowOnboarding(false);
  }, [updateSettings]);

  const handleModelChange = useCallback(
    (model: string) => {
      if (activeConversationId) {
        updateConversationModel(activeConversationId, model);
      } else {
        setPendingModel(model);
      }
    },
    [activeConversationId, updateConversationModel]
  );

  const handleSend = useCallback(
    (content: string) => {
      const modelToUse = pendingModel;
      setPendingModel(null);
      sendMessage(content, modelToUse ?? undefined);
    },
    [pendingModel, sendMessage]
  );

  const handleMemoryDismiss = useCallback(() => {
    setMemoryFacts([]);
  }, []);

  const handleGithubPathSet = useCallback(async (path: string) => {
    await updateSettings({ defaultProjectPath: path });
    if (pendingGithubUrl) {
      retryGithubClone(pendingGithubUrl);
    }
  }, [updateSettings, pendingGithubUrl, retryGithubClone]);

  const handleScrollStateChange = useCallback((showBtn: boolean, scrollFn: () => void) => {
    setShowScrollBtn(showBtn);
    scrollFnRef.current = scrollFn;
  }, []);

  // Branch switching: find the adjacent sibling and switch to it
  const handleSwitchBranch = useCallback((direction: 'prev' | 'next', messageId: string) => {
    if (!activeConversation) return

    const msg = activeConversation.messages.find(m => m.id === messageId)
    if (!msg) return

    const siblings = getSiblings(activeConversation.messages, msg.parentId)
    const currentIndex = siblings.findIndex(s => s.id === messageId)
    if (currentIndex === -1) return

    let targetIndex: number
    if (direction === 'prev' && currentIndex > 0) {
      targetIndex = currentIndex - 1
    } else if (direction === 'next' && currentIndex < siblings.length - 1) {
      targetIndex = currentIndex + 1
    } else {
      return
    }

    switchBranch(siblings[targetIndex].id)
  }, [activeConversation, switchBranch])

  // Clear pending model and scroll state when a conversation becomes active
  useEffect(() => {
    if (activeConversationId) {
      setPendingModel(null);
    }
    setShowScrollBtn(false);
    setFocusTrigger((t) => t + 1);
  }, [activeConversationId]);

  return (
    <div className="chat-layout">
      <Sidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={setActiveConversationId}
        onNewConversation={startNewConversation}
        onDeleteConversation={deleteConversation}
        onArchiveConversation={archiveConversation}
        onRenameConversation={renameConversation}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />
      <main className="chat-layout__main">
        <div className="chat-layout__header">
          <h1 className="chat-layout__title">{activeConversation?.title ?? 'A.U.R.A.'}</h1>
          <div className="chat-layout__header-controls">
            <div className="chat-layout__status">
              <span className={`status-dot-wrapper ${ollamaOnline ? 'status-dot-wrapper--online' : 'status-dot-wrapper--offline'}`}>
                <span className={`status-dot ${ollamaOnline ? 'status-dot--online' : 'status-dot--offline'}`} />
                {ollamaOnline && <span className="status-dot-ripple" />}
              </span>
              <span className={`chat-layout__status-text ${ollamaOnline ? '' : 'chat-layout__status-text--offline'}`}>
                {!serverOnline ? 'Offline' : ollamaOnline ? 'Online' : 'No Model'}
              </span>
            </div>
            <ModelSelector
              models={models}
              currentModel={activeConversation?.model ?? pendingModel ?? settings.defaultModel ?? models[0]?.name ?? ''}
              onModelChange={handleModelChange}
            />
          </div>
          <div className="chat-layout__header-actions">
            <Tooltip content="Project Mode" position="bottom">
              <ProjectModeButton projectModeAccepted={activeConversation?.projectModeAccepted} projectId={activeConversation?.projectId} conversationId={activeConversationId} />
            </Tooltip>
            <Tooltip content="Settings" position="bottom">
              <GlowButton variant="ghost" onClick={() => setSettingsOpen(true)} className={settingsOpen ? 'chat-layout__settings-btn--open' : ''}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </GlowButton>
            </Tooltip>
          </div>
        </div>
        {activeConversation?.archived && (
          <div className="chat-layout__archived-banner">
            This conversation is archived.{' '}
            <button className="chat-layout__archived-unarchive" onClick={() => unarchiveConversation(activeConversation.id)}>
              Unarchive
            </button>{' '}
            to continue chatting.
          </div>
        )}
        <MessageList
          messages={visibleMessages}
          allMessages={activeConversation?.messages ?? []}
          activeLeafId={activeConversation?.activeLeafId}
          isTyping={isTyping}
          onScrollStateChange={handleScrollStateChange}
          onSwitchBranch={handleSwitchBranch}
          onEditMessage={editMessage}
          onRegenerate={regenerateResponse}
          onCopyMessage={copyMessage}
        />
        {showScrollBtn && (
          <div className="scroll-to-bottom-wrapper">
            <Tooltip content="Scroll to bottom" position="top">
              <button className="scroll-to-bottom-btn" onClick={() => scrollFnRef.current()}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M19 12l-7 7-7-7" />
                </svg>
              </button>
            </Tooltip>
          </div>
        )}
        <div className="chat-layout__input-area">
          <ChatInput
            onSend={handleSend}
            onStop={stopGeneration}
            isTyping={isTyping}
            disabled={!!activeConversation?.archived}
            focusTrigger={focusTrigger}
          />
        </div>
      </main>
      <SettingsPanel
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        systemPrompt={''}
        onSystemPromptChange={() => {}}
        settings={settings}
        models={models}
        onSettingsChange={updateSettings}
        onPreferenceChange={(key, value) =>
          updatePreferences({ [key]: value } as Record<string, string | null>)
        }
        memories={memories}
        onAddMemory={addMemory}
        onUpdateMemory={updateMemory}
        onDeleteMemory={deleteMemory}
        onDeleteAllMemories={deleteAllMemories}
        onRefreshMemories={fetchMemories}
        skills={skills}
        onToggleSkill={toggleSkill}
        onDeleteSkill={deleteSkill}
        onDeleteAllSkills={deleteAllSkills}
        onRefreshSkills={fetchSkills}
        onAddSkill={addSkill}
        onLockSkill={lockSkill}
        onEditSkill={(skill) => {
          if (skill.handler.type === 'code') {
            setSettingsOpen(false);
            navigate(`/playground?edit=${skill.id}`);
          }
        }}
        onUpdateSkill={updateSkill}
        onOpenPlayground={() => { setSettingsOpen(false); navigate('/playground') }}
        conversations={conversations}
        onSelectConversation={setActiveConversationId}
        onUnarchiveConversation={unarchiveConversation}
        onDeleteConversation={deleteConversation}
        onDeleteAllArchived={() => deleteAllConversations(true)}
        onDeleteAllConversations={() => deleteAllConversations(false)}
      />
      <OnboardingModal
        open={showOnboarding}
        onComplete={handleOnboardingComplete}
        onSkip={handleOnboardingSkip}
      />
      <MemoryNotification
        facts={memoryFacts}
        onDismiss={handleMemoryDismiss}
      />
      <ProjectModeModal
        open={projectModeSuggested || !!existingProjectChoice}
        existingProject={existingProjectChoice}
        onAccept={acceptProjectMode}
        onOpenExisting={openExistingProject}
        onCreateNew={createNewProject}
        onDismiss={continueInChat}
      />
      <GithubClonePathModal
        open={!!pendingGithubUrl}
        githubUrl={pendingGithubUrl}
        onPathSet={handleGithubPathSet}
        onDismiss={dismissGithubPathModal}
      />
    </div>
  );
}