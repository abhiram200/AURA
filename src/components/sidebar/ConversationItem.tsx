import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import type { ConversationSummary } from '../../hooks/useChat';
import { useAnimationConfig } from '../../hooks/useAnimationConfig';
import { getTransition } from '../../hooks/useAnimationConfig';

interface ConversationItemProps {
  conversation: ConversationSummary;
  isActive: boolean;
  onClick: () => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

export function ConversationItem({ conversation, isActive, onClick, onDelete, onArchive, onRename }: ConversationItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(conversation.title);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { animationIntensity } = useAnimationConfig();

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== conversation.title) {
      onRename(conversation.id, trimmed);
    }
    setRenaming(false);
  };

  return (
    <motion.div
      className={`conversation-item ${isActive ? 'conversation-item--active' : ''} ${menuOpen ? 'conversation-item--menu-open' : ''}`}
      onClick={renaming ? undefined : onClick}
      whileHover={animationIntensity !== 'subtle' ? { x: 4 } : undefined}
      transition={getTransition(0.2, animationIntensity)}
    >
      {isActive && (
        <motion.div
          className="conversation-item__indicator"
          layoutId="active-conversation"
          transition={getTransition({ type: 'spring', stiffness: 300, damping: 30 }, animationIntensity)}
        />
      )}
      <div className="conversation-item__content">
        {renaming ? (
          <input
            ref={inputRef}
            className="conversation-item__rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') { setRenameValue(conversation.title); setRenaming(false); }
            }}
            onBlur={handleRenameSubmit}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="conversation-item__title">{conversation.title}</span>
        )}
        <span className="conversation-item__meta">
          {conversation.model}
        </span>
      </div>
      <button
        className="conversation-item__more"
        onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
        aria-label="More options"
      >
        &#8943;
      </button>
      {menuOpen && (
        <div ref={menuRef} className="conversation-item__menu">
          <button
            className="conversation-item__menu-item"
            onClick={(e) => { e.stopPropagation(); setRenaming(true); setRenameValue(conversation.title); setMenuOpen(false); }}
          >
            Rename
          </button>
          <button
            className="conversation-item__menu-item"
            onClick={(e) => { e.stopPropagation(); onArchive(conversation.id); setMenuOpen(false); }}
          >
            Archive
          </button>
          <button
            className="conversation-item__menu-item conversation-item__menu-item--danger"
            onClick={(e) => { e.stopPropagation(); onDelete(conversation.id); setMenuOpen(false); }}
          >
            Delete
          </button>
        </div>
      )}
    </motion.div>
  );
}