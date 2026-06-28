import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAnimationConfig } from '../../hooks/useAnimationConfig'
import { getTransition } from '../../hooks/useAnimationConfig'
import type { Project } from '../../hooks/useProjectMode'

interface DeleteProjectModalProps {
  open: boolean
  project: Project | null
  onDeleteEverywhere: () => void
  onDeleteFromBuilder: () => void
  onCancel: () => void
}

export function DeleteProjectModal({ open, project, onDeleteEverywhere, onDeleteFromBuilder, onCancel }: DeleteProjectModalProps) {
  const { animationIntensity } = useAnimationConfig()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    if (open) {
      document.addEventListener('keydown', handler)
      return () => document.removeEventListener('keydown', handler)
    }
  }, [open, onCancel])

  return (
    <AnimatePresence>
      {open && project && (
        <motion.div
          className="delete-project-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={getTransition(0.15, animationIntensity)}
          onClick={onCancel}
        >
          <motion.div
            className="delete-project-modal"
            initial={animationIntensity !== 'subtle' ? { opacity: 0, y: 20, scale: 0.97 } : { opacity: 1, y: 0, scale: 1 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={animationIntensity !== 'subtle' ? { opacity: 0, y: 10, scale: 0.97 } : { opacity: 0 }}
            transition={getTransition({ type: 'spring', stiffness: 300, damping: 30 }, animationIntensity)}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="delete-project-modal__icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </div>
            <h2 className="delete-project-modal__title">Delete Project?</h2>
            <p className="delete-project-modal__project-name">{project.name}</p>
            <p className="delete-project-modal__path">{project.workspacePath}</p>
            <p className="delete-project-modal__subtitle">
              This action cannot be undone. Choose how you want to delete this project.
            </p>
            <div className="delete-project-modal__actions">
              <button className="delete-project-modal__danger" onClick={onDeleteEverywhere}>
                Delete from Everywhere
              </button>
              <button className="delete-project-modal__secondary" onClick={onDeleteFromBuilder}>
                Delete from Builder
              </button>
              <button className="delete-project-modal__cancel" onClick={onCancel}>
                Cancel
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}