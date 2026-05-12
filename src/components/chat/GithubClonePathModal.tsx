import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAnimationConfig } from '../../hooks/useAnimationConfig'
import { getTransition } from '../../hooks/useAnimationConfig'

interface GithubClonePathModalProps {
  open: boolean
  githubUrl: string | null
  onPathSet: (path: string) => void
  onDismiss: () => void
}

export function GithubClonePathModal({ open, githubUrl, onPathSet, onDismiss }: GithubClonePathModalProps) {
  const { animationIntensity } = useAnimationConfig()
  const [pathInput, setPathInput] = useState('')
  const [saving, setSaving] = useState(false)

  const repoName = githubUrl ? githubUrl.split('/').pop()?.replace('.git', '') || 'repo' : 'repo'

  useEffect(() => {
    if (open) {
      setPathInput('')
      setSaving(false)
    }
  }, [open])

  const handleSubmit = async () => {
    const trimmed = pathInput.trim()
    if (!trimmed || saving) return
    setSaving(true)
    onPathSet(trimmed)
  }

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
            <div className="project-mode-modal__icon">&#128193;</div>
            <h2 className="project-mode-modal__title">Set Default Project Path</h2>
            <p className="project-mode-modal__subtitle">
              To clone <strong>{githubUrl ? repoName : 'the repository'}</strong>, set a default directory where AURA will store project folders.
              This path will be saved for future projects too.
            </p>
            <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
              <input
                className="folder-picker__input"
                type="text"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
                placeholder="C:\Projects or /home/user/projects"
                style={{ width: '100%' }}
                autoFocus
                disabled={saving}
              />
              {pathInput.trim() && (
                <div className="folder-picker__hint">
                  Repo will be cloned to: {pathInput.trim().replace(/[/\\]+$/, '')}{pathInput.trim().includes('\\') ? '\\' : '/'}{repoName}
                </div>
              )}
              <div className="project-mode-modal__actions">
                <button
                  className="project-mode-modal__accept"
                  disabled={!pathInput.trim() || saving}
                  onClick={handleSubmit}
                >
                  {saving ? 'Saving & Cloning...' : 'Set Path & Clone'}
                </button>
                <button className="project-mode-modal__dismiss" onClick={onDismiss} disabled={saving}>
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}