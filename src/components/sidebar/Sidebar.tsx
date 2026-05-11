import { motion, AnimatePresence } from 'framer-motion';
import { GlowButton } from '../shared/GlowButton';
import { ThemeToggle } from '../shared/ThemeToggle';
import { ConversationItem } from './ConversationItem';
import type { ConversationSummary } from '../../hooks/useChat';
import { useAnimationConfig } from '../../hooks/useAnimationConfig';
import { getTransition } from '../../hooks/useAnimationConfig';

interface SidebarProps {
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onArchiveConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export function Sidebar({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onArchiveConversation,
  onRenameConversation,
  isOpen,
  onToggle,
}: SidebarProps) {
  const visibleConversations = conversations.filter((c) => !c.archived);
  const { animationIntensity } = useAnimationConfig();
  const springTransition = getTransition({ type: 'spring', stiffness: 300, damping: 30 }, animationIntensity);

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.aside
            className="sidebar"
            initial={{ x: -240, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -240, opacity: 0 }}
            transition={springTransition}
          >
            <div className="sidebar__header">
              <div>
                <h2 className="sidebar__title">A.U.R.A.</h2>
                <span className="sidebar__tagline">Artificial Unified Responsive Assistant</span>
              </div>
              <ThemeToggle />
            </div>
            <GlowButton onClick={onNewConversation} variant="primary" className="sidebar__new-btn">
              + New Chat
            </GlowButton>
            <div className="sidebar__list">
              {visibleConversations.map((conv) => (
                <ConversationItem
                  key={conv.id}
                  conversation={conv}
                  isActive={conv.id === activeConversationId}
                  onClick={() => onSelectConversation(conv.id)}
                  onDelete={onDeleteConversation}
                  onArchive={onArchiveConversation}
                  onRename={onRenameConversation}
                />
              ))}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
      <motion.button
        className="sidebar__toggle"
        onClick={onToggle}
        whileHover={animationIntensity !== 'subtle' ? { scale: 1.1 } : undefined}
        whileTap={animationIntensity !== 'subtle' ? { scale: 0.9 } : undefined}
      >
        {isOpen ? '◀' : '▶'}
      </motion.button>
    </>
  );
}