import { useEffect, useRef, useCallback, useMemo } from 'react';
import { UserMessage } from './UserMessage';
import { AIMessage } from './AIMessage';
import type { Message } from '../../hooks/useChat';

interface MessageListProps {
  messages: Message[];
  allMessages: Message[];
  activeLeafId: string | null | undefined;
  isTyping: boolean;
  onScrollStateChange?: (showBtn: boolean, scrollFn: () => void) => void;
  onSwitchBranch?: (direction: 'prev' | 'next', messageId: string) => void;
  onEditMessage?: (messageId: string, newContent: string) => void;
  onRegenerate?: (messageId: string) => void;
  onCopyMessage?: (messageId: string) => void;
}

export function MessageList({
  messages,
  allMessages,
  activeLeafId,
  isTyping,
  onScrollStateChange,
  onSwitchBranch,
  onEditMessage,
  onRegenerate,
  onCopyMessage,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const isAutoScrollingRef = useRef(false);

  const isAtBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  const scrollToBottom = useCallback(() => {
    isAutoScrollingRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    // Reset the flag after the smooth scroll animation finishes
    setTimeout(() => {
      isAutoScrollingRef.current = false;
    }, 500);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleScroll = () => {
      // Ignore scroll events triggered by our own scrollIntoView calls
      if (isAutoScrollingRef.current) return;

      const atBottom = isAtBottom();
      autoScrollRef.current = atBottom;
      onScrollStateChange?.(!atBottom, scrollToBottom);
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [isAtBottom, onScrollStateChange, scrollToBottom]);

  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (autoScrollRef.current || lastMsg?.role === 'user') {
      isAutoScrollingRef.current = true;
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => {
        isAutoScrollingRef.current = false;
      }, 500);
    }
  }, [messages, isTyping]);

  const siblingInfo = useMemo(() => {
    const info = new Map<string, { count: number; index: number }>();

    const byParent = new Map<string | null, Message[]>();
    for (const msg of allMessages) {
      const key = msg.parentId ?? null;
      const group = byParent.get(key) ?? [];
      group.push(msg);
      byParent.set(key, group);
    }

    for (const [, group] of byParent) {
      group.sort((a, b) => a.timestamp - b.timestamp);
      group.forEach((msg, idx) => {
        info.set(msg.id, { count: group.length, index: idx });
      });
    }

    return info;
  }, [allMessages]);

  return (
    <div className="message-list" ref={containerRef}>
      {messages.length === 0 && !isTyping && (
        <div className="message-list__empty">
          <div className="message-list__empty-icon">*</div>
          <h3>Start a conversation</h3>
          <p>Send a message to begin chatting with AI</p>
        </div>
      )}
      {messages.map((msg) => {
        const info = siblingInfo.get(msg.id);
        const siblingCount = info?.count ?? 1;
        const siblingIndex = info?.index ?? 0;

        return msg.role === 'user' ? (
          <UserMessage
            key={msg.id}
            message={msg}
            siblingCount={siblingCount}
            siblingIndex={siblingIndex}
            onSwitchBranch={(direction) => onSwitchBranch?.(direction, msg.id)}
            onEdit={onEditMessage}
            onCopy={onCopyMessage}
          />
        ) : (
          <AIMessage
            key={msg.id}
            message={msg}
            isStreaming={msg.isStreaming}
            siblingCount={siblingCount}
            siblingIndex={siblingIndex}
            onSwitchBranch={(direction) => onSwitchBranch?.(direction, msg.id)}
            onRegenerate={onRegenerate}
            onCopy={onCopyMessage}
          />
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}