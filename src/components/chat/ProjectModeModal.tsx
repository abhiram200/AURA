import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAnimationConfig } from '../../hooks/useAnimationConfig'
import { getTransition } from '../../hooks/useAnimationConfig'

interface ProjectModeModalProps {
  open: boolean
  existingProject?: { id: string; name: string } | null
  onAccept: () => void
  onOpenExisting: () => void
  onCreateNew: () => void
  onDismiss: () => void
}

export function ProjectModeModal({ open, existingProject, onAccept, onOpenExisting, onCreateNew, onDismiss }: ProjectModeModalProps) {
  const { animationIntensity } = useAnimationConfig()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    if (open) {
      document.addEventListener('keydown', handler)
      return () => document.removeEventListener('keydown', handler)
    }
  }, [open, onDismiss])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="project-mode-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={getTransition(0.15, animationIntensity)}
          onClick={onDismiss}
        >
          <motion.div
            className="project-mode-modal"
            initial={animationIntensity !== 'subtle' ? { opacity: 0, y: 20, scale: 0.97 } : { opacity: 1, y: 0, scale: 1 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={animationIntensity !== 'subtle' ? { opacity: 0, y: 10, scale: 0.97 } : { opacity: 0 }}
            transition={getTransition({ type: 'spring', stiffness: 300, damping: 30 }, animationIntensity)}
            onClick={(e) => e.stopPropagation()}
          >
            {existingProject ? (
              <>
                <div className="project-mode-modal__icon">&#128193;</div>
                <h2 className="project-mode-modal__title">Project Already Exists</h2>
                <p className="project-mode-modal__subtitle">
                  A project named <strong>"{existingProject.name}"</strong> already exists in your project builder. Would you like to open it or create a new one?
                </p>
                <div className="project-mode-modal__actions project-mode-modal__actions--three">
                  <button className="project-mode-modal__accept" onClick={onOpenExisting}>
                    Open Existing
                  </button>
                  <button className="project-mode-modal__create-new" onClick={onCreateNew}>
                    Create New
                  </button>
                  <button className="project-mode-modal__dismiss" onClick={onDismiss}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="project-mode-modal__icon">*</div>
                <h2 className="project-mode-modal__title">Switch to Project Mode?</h2>
                <p className="project-mode-modal__subtitle">
                  It looks like you're starting a project. Project mode provides a streamlined experience for building.
                </p>
                <ul className="project-mode-modal__benefits">
                  <li>Structured project planning and step-by-step execution</li>
                  <li>Dedicated workspace for managing project files and progress</li>
                  <li>Enhanced context tracking across multiple sessions</li>
                </ul>
                <div className="project-mode-modal__actions">
                  <button className="project-mode-modal__accept" onClick={onAccept}>
                    Enable Project Mode
                  </button>
                  <button className="project-mode-modal__dismiss" onClick={onDismiss}>
                    Continue in Chat
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}