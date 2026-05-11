import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tooltip } from '../shared/Tooltip';
import type { Message } from '../../hooks/useChat';

interface UserMessageProps {
  message: Message;
  siblingCount?: number;
  siblingIndex?: number;
  onSwitchBranch?: (direction: 'prev' | 'next') => void;
  onEdit?: (messageId: string, newContent: string) => void;
  onCopy?: (messageId: string) => void;
}

export function UserMessage({ message, siblingCount, siblingIndex, onSwitchBranch, onEdit, onCopy }: UserMessageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [showActions, setShowActions] = useState(false);
  const [copied, setCopied] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [editSize, setEditSize] = useState<{ width: number; height: number } | null>(null);
  const hasSiblings = (siblingCount ?? 1) > 1;

  const startEditing = () => {
    if (bubbleRef.current) {
      const rect = bubbleRef.current.getBoundingClientRect();
      setEditSize({ width: rect.width, height: rect.height });
    }
    setEditContent(message.content);
    setIsEditing(true);
  };

  useEffect(() => {
    if (isEditing && editRef.current) {
      editRef.current.focus();
      editRef.current.style.height = 'auto';
      editRef.current.style.height = editRef.current.scrollHeight + 'px';
    }
  }, [isEditing]);

  const handleEditSubmit = () => {
    const trimmed = editContent.trim();
    if (trimmed && trimmed !== message.content) {
      onEdit?.(message.id, trimmed);
    }
    setIsEditing(false);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEditSubmit();
    } else if (e.key === 'Escape') {
      setEditContent(message.content);
      setIsEditing(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onCopy?.(message.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const showBar = showActions && !isEditing;

  return (
    <motion.div
      className="user-message"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className="user-message__content-wrapper">
        {hasSiblings && (
          <div className="branch-navigator branch-navigator--user">
            <Tooltip content="Previous version">
              <button
                className="branch-navigator__btn"
                onClick={() => onSwitchBranch?.('prev')}
                disabled={siblingIndex === 0}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
            </Tooltip>
            <span className="branch-navigator__label">{(siblingIndex ?? 0) + 1}/{siblingCount}</span>
            <Tooltip content="Next version">
              <button
                className="branch-navigator__btn"
                onClick={() => onSwitchBranch?.('next')}
                disabled={siblingIndex === (siblingCount ?? 1) - 1}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            </Tooltip>
          </div>
        )}
        {isEditing ? (
          <div className="user-message__edit-wrapper" style={editSize ? { width: `${editSize.width}px`, maxWidth: '70%' } : undefined}>
            <textarea
              ref={editRef}
              className="user-message__edit-input"
              style={editSize ? { height: `${editSize.height}px` } : undefined}
              value={editContent}
              onChange={(e) => {
                setEditContent(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = e.target.scrollHeight + 'px'
              }}
              onKeyDown={handleEditKeyDown}
              rows={1}
            />
            <div className="user-message__edit-actions">
              <button className="user-message__edit-btn user-message__edit-btn--save" onClick={handleEditSubmit}>
                Save & Submit
              </button>
              <button className="user-message__edit-btn user-message__edit-btn--cancel" onClick={() => { setEditContent(message.content); setIsEditing(false); }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="user-message__bubble" ref={bubbleRef}>{message.content}</div>
        )}
        <AnimatePresence>
          {showBar && (
            <motion.div
              className="message-actions message-actions--below"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
            >
              {onEdit && (
                <Tooltip content="Edit message">
                  <button className="message-action-btn" onClick={startEditing}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                </Tooltip>
              )}
              <Tooltip content={copied ? 'Copied!' : 'Copy message'}>
                <button className="message-action-btn" onClick={handleCopy}>
                  {copied ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  )}
                </button>
              </Tooltip>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}