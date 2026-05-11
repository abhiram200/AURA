import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { SkillPlayground } from '../components/settings/SkillPlayground'
import type { OllamaModel } from '../hooks/useSettings'
import type { SkillEntry } from '../hooks/useSkills'

export function PlaygroundPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const editSkillId = searchParams.get('edit')

  const [models, setModels] = useState<OllamaModel[]>([])
  const [defaultModel, setDefaultModel] = useState('')
  const [editSkill, setEditSkill] = useState<SkillEntry | undefined>()
  const [editSkillLoaded, setEditSkillLoaded] = useState(!editSkillId)

  useEffect(() => {
    fetch('/api/models').then(r => r.ok ? r.json() : { models: [] }).then(d => setModels(d.models ?? []))
    fetch('/api/settings').then(r => r.ok ? r.json() : {}).then(s => setDefaultModel(s.defaultModel ?? ''))
  }, [])

  useEffect(() => {
    if (editSkillId) {
      fetch('/api/skills').then(r => r.ok ? r.json() : { skills: [] }).then(d => {
        const skill = (d.skills ?? []).find((s: SkillEntry) => s.id === editSkillId)
        if (skill) setEditSkill(skill)
        setEditSkillLoaded(true)
      })
    }
  }, [editSkillId])

  const handleClose = useCallback(() => navigate('/'), [])
  const handleSaved = useCallback(() => navigate('/'), [navigate])

  if (!editSkillLoaded) return null

  return (
    <SkillPlayground
      onClose={handleClose}
      onSaved={handleSaved}
      models={models}
      defaultModel={defaultModel}
      editSkill={editSkill}
    />
  )
}