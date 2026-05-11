import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { StreamingText } from './StreamingText';
import { ThinkingSection } from './ThinkingSection';
import { ToolCallIndicator } from './ToolCallIndicator';
import { Tooltip } from '../shared/Tooltip';
import type { Message } from '../../hooks/useChat';

interface AIMessageProps {
  message: Message;
  isStreaming?: boolean;
  siblingCount?: number;
  siblingIndex?: number;
  onSwitchBranch?: (direction: 'prev' | 'next') => void;
  onRegenerate?: (messageId: string) => void;
  onCopy?: (messageId: string) => void;
}

export function AIMessage({
  message,
  isStreaming,
  siblingCount,
  siblingIndex,
  onSwitchBranch,
  onRegenerate,
  onCopy,
}: AIMessageProps) {
  const [glowActive, setGlowActive] = useState(true);
  const [showActions, setShowActions] = useState(false);
  const [copied, setCopied] = useState(false);
  const contentRef = useRef<string>(message.content);
  const hasSiblings = (siblingCount ?? 1) > 1;

  useEffect(() => {
    contentRef.current = message.content;
  }, [message.content]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(contentRef.current);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onCopy?.(message.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isError = message.content.startsWith('Error:');
  const showBar = showActions && !isStreaming;

  return (
    <motion.div
      className={`ai-message ${glowActive ? 'ai-message--glow' : ''}`}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      onAnimationComplete={() => setGlowActive(false)}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className="ai-message__avatar">AI</div>
      <div className="ai-message__body">
        <div className="ai-message__card">
          {hasSiblings && (
            <div className="branch-navigator branch-navigator--ai">
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
          {message.thinking && (
            <ThinkingSection content={message.thinking} isStreaming={!!message.isThinking} />
          )}
          {message.toolCalls?.map((tc, i) => (
            <ToolCallIndicator
              key={i}
              name={tc.name}
              args={tc.args}
              result={tc.result}
              isLoading={!tc.result}
            />
          ))}
          <StreamingText content={message.content} isStreaming={!!isStreaming} />
        </div>
        <AnimatePresence>
          {showBar && (
            <motion.div
              className="message-actions message-actions--below"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
            >
              {onRegenerate && !isError && (
                <Tooltip content="Regenerate response">
                  <button
                    className="message-action-btn"
                    onClick={() => onRegenerate(message.id)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
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