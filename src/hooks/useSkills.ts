import { useState, useEffect, useCallback } from 'react'

export interface SkillEntry {
  id: string
  name: string
  definition: {
    type: 'function'
    function: {
      name: string
      description: string
      parameters?: {
        type: string
        properties: Record<string, unknown>
        required?: string[]
      }
    }
  }
  handler: {
    type: 'builtin' | 'api' | 'code'
    action?: string
    url?: string
    method?: string
    headers?: Record<string, string>
    code?: string
  }
  active: boolean
  locked: boolean
  createdAt: string
}

export function useSkills() {
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [loading, setLoading] = useState(true)

  const fetchSkills = useCallback(async () => {
    try {
      const res = await fetch('/api/skills')
      if (res.ok) {
        const data = await res.json()
        setSkills(data.skills)
      }
    } catch {
      // Use empty list
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSkills()
  }, [fetchSkills])

  const addSkill = useCallback(async (definition: SkillEntry['definition'], handler: SkillEntry['handler']) => {
    const res = await fetch('/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definition, handler }),
    })
    if (res.ok) {
      const skill = await res.json()
      setSkills((prev) => [...prev, skill])
      return skill
    }
    return null
  }, [])

  const updateSkill = useCallback(async (id: string, updates: { active?: boolean; handler?: SkillEntry['handler']; locked?: boolean }) => {
    const res = await fetch(`/api/skills/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    if (res.ok) {
      const skill = await res.json()
      setSkills((prev) => prev.map((s) => (s.id === id ? skill : s)))
      return skill
    }
    return null
  }, [])

  const deleteSkill = useCallback(async (id: string, force?: boolean) => {
    const url = force ? `/api/skills/${id}?force=true` : `/api/skills/${id}`
    const res = await fetch(url, { method: 'DELETE' })
    if (res.ok) {
      const data = await fetch('/api/skills')
      if (data.ok) {
        const json = await data.json()
        setSkills(json.skills)
      }
    }
  }, [])

  const deleteAllSkills = useCallback(async () => {
    const res = await fetch('/api/skills', { method: 'DELETE' })
    if (res.ok) {
      const data = await fetch('/api/skills')
      if (data.ok) {
        const json = await data.json()
        setSkills(json.skills)
      }
    }
  }, [])

  const toggleSkill = useCallback(async (id: string, active: boolean) => {
    return updateSkill(id, { active })
  }, [updateSkill])

  const lockSkill = useCallback(async (id: string, locked: boolean) => {
    return updateSkill(id, { locked })
  }, [updateSkill])

  return { skills, loading, addSkill, updateSkill, deleteSkill, deleteAllSkills, toggleSkill, lockSkill, fetchSkills }
}