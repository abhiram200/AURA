import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Tooltip } from '../shared/Tooltip';

interface ChatInputProps {
  onSend: (message: string) => void;
  onStop?: () => void;
  isTyping?: boolean;
  disabled?: boolean;
  focusTrigger?: number;
}

export function ChatInput({ onSend, onStop, isTyping, disabled = false, focusTrigger }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [focusTrigger]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + 'px';
    }
  }, [value]);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    setIsSubmitting(true);
    setTimeout(() => setIsSubmitting(false), 600);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !disabled && !isTyping) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const canSend = value.trim() && !disabled;

  return (
    <motion.div
      className={`chat-input ${isFocused ? 'chat-input--focused' : ''} ${isSubmitting ? 'chat-input--submitting' : ''}`}
      animate={isSubmitting ? { scale: [1, 0.98, 1] } : {}}
      transition={{ duration: 0.3 }}
    >
      <textarea
        ref={textareaRef}
        className="chat-input__textarea"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onKeyDown={handleKeyDown}
        placeholder="Type your message..."
        rows={1}
        autoFocus
      />
      {isTyping && onStop ? (
        <Tooltip content="Stop generation">
          <motion.button
            className="chat-input__stop"
            onClick={onStop}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.9 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </motion.button>
        </Tooltip>
      ) : (
        <Tooltip content="Send message">
          <motion.button
            className="chat-input__send"
            onClick={handleSubmit}
            disabled={!canSend}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.9 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </motion.button>
        </Tooltip>
      )}
    </motion.div>
  );
}