import { useState } from 'react';
import type { ConversationSummary } from '../../hooks/useChat';

interface ArchivedChatsProps {
  conversations: ConversationSummary[];
  onSelect: (id: string) => void;
  onUnarchive: (id: string) => void;
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
}

export function ArchivedChats({ conversations, onSelect, onUnarchive, onDelete, onDeleteAll }: ArchivedChatsProps) {
  const archived = conversations.filter((c) => c.archived);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  const handleDeleteAll = () => {
    if (confirmDeleteAll) {
      onDeleteAll();
      setConfirmDeleteAll(false);
    } else {
      setConfirmDeleteAll(true);
    }
  };

  if (archived.length === 0) {
    return <p className="archived-chats__empty">No archived chats.</p>;
  }

  return (
    <div>
      <div className="archived-chats__header">
        <span className="archived-chats__count">{archived.length} archived</span>
        <button
          className={`archived-chats__delete-all-btn ${confirmDeleteAll ? 'archived-chats__delete-all-btn--confirm' : ''}`}
          onClick={handleDeleteAll}
          onBlur={() => setConfirmDeleteAll(false)}
        >
          {confirmDeleteAll ? 'Confirm delete all?' : 'Delete all'}
        </button>
      </div>
      <ul className="archived-chats__list">
        {archived.map((conv) => (
          <li key={conv.id} className="archived-chats__item archived-chats__item--clickable" onClick={() => onSelect(conv.id)}>
            <div className="archived-chats__info">
              <span className="archived-chats__title">{conv.title}</span>
              <span className="archived-chats__meta">{conv.model}</span>
            </div>
            <div className="archived-chats__actions">
              <button
                className="archived-chats__unarchive-btn"
                onClick={(e) => { e.stopPropagation(); onUnarchive(conv.id); }}
              >
                Restore
              </button>
              <button
                className="archived-chats__delete-btn"
                onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}