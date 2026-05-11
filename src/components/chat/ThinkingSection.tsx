import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ThinkingSectionProps {
  content: string;
  isStreaming: boolean;
}

export function ThinkingSection({ content, isStreaming }: ThinkingSectionProps) {
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!isStreaming) {
      setExpanded(false);
    }
  }, [isStreaming]);

  if (!content) return null;

  return (
    <div className={`thinking-section ${isStreaming ? 'thinking-section--streaming' : ''}`}>
      <button className="thinking-section__header" onClick={() => setExpanded(!expanded)}>
        <span className="thinking-section__toggle">{expanded ? '▼' : '▶'}</span>
        <span className="thinking-section__label">
          {isStreaming ? 'Thinking...' : 'Thought process'}
        </span>
        {isStreaming && <span className="thinking-section__spinner" />}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            className="thinking-section__content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="thinking-section__text">{content}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}