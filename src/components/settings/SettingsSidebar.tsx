import { motion, AnimatePresence } from 'framer-motion';
import { useAnimationConfig } from '../../hooks/useAnimationConfig';
import { getTransition } from '../../hooks/useAnimationConfig';
import { SettingsPanel } from './SettingsPanel';
import type { AppSettings, OllamaModel } from '../../hooks/useSettings';

interface SettingsSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  models: OllamaModel[];
  onSettingsChange: (updates: Partial<AppSettings>) => void;
}

export function SettingsSidebar({ isOpen, onClose, settings, models, onSettingsChange }: SettingsSidebarProps) {
  const { animationIntensity } = useAnimationConfig();
  const slideTransition = getTransition({ type: 'spring', stiffness: 300, damping: 30 }, animationIntensity);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="settings-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={getTransition(0.2, animationIntensity)}
            onClick={onClose}
          />
          <motion.aside
            className="settings-panel"
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            transition={slideTransition}
          >
            <div className="settings-panel__header">
              <h2 className="settings-panel__brand">A.U.R.A.</h2>
              <button className="settings-panel__close" onClick={onClose} title="Close settings">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="settings-panel__body">
              <SettingsPanel settings={settings} models={models} onSettingsChange={onSettingsChange} />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}