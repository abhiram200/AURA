import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAnimationConfig } from '../../hooks/useAnimationConfig';
import { getTransition } from '../../hooks/useAnimationConfig';

interface SettingsModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function SettingsModal({ title, onClose, children }: SettingsModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const { animationIntensity } = useAnimationConfig();
  const springTransition = getTransition({ type: 'spring', stiffness: 300, damping: 30 }, animationIntensity);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <AnimatePresence>
      <motion.div
        className="settings-modal-backdrop"
        ref={backdropRef}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={getTransition(0.15, animationIntensity)}
        onClick={onClose}
      >
        <motion.div
          className="settings-modal"
          initial={animationIntensity !== 'subtle' ? { opacity: 0, y: 20, scale: 0.97 } : { opacity: 1, y: 0, scale: 1 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={animationIntensity !== 'subtle' ? { opacity: 0, y: 10, scale: 0.97 } : { opacity: 0 }}
          transition={springTransition}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="settings-modal__header">
            <h3 className="settings-modal__title">{title}</h3>
            <button className="settings-modal__close" onClick={onClose}>✕</button>
          </div>
          <div className="settings-modal__body">
            {children}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}