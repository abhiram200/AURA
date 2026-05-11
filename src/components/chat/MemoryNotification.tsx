import { motion, AnimatePresence } from 'framer-motion';

interface MemoryNotificationProps {
  facts: string[];
  onDismiss: () => void;
}

export function MemoryNotification({ facts, onDismiss }: MemoryNotificationProps) {
  if (facts.length === 0) return null;

  const message =
    facts.length === 1
      ? `Memory saved: '${facts[0]}'`
      : `${facts.length} memories saved`;

  return (
    <AnimatePresence>
      <motion.div
        className="memory-notification"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        onClick={onDismiss}
        role="status"
      >
        <span className="memory-notification__icon">&#129504;</span>
        <span className="memory-notification__text">{message}</span>
        <button className="memory-notification__dismiss" onClick={onDismiss} aria-label="Dismiss">
          &times;
        </button>
      </motion.div>
    </AnimatePresence>
  );
}