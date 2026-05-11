import { useState, useCallback } from 'react'

export type CodeTestResult =
  | { success: true; result: string }
  | { success: false; error: string }

export type LLMTestStep =
  | { step: 'definition_validated' }
  | { step: 'code_compiled' }
  | { step: 'llm_thinking'; content: string }
  | { step: 'tool_call'; name: string; args: Record<string, unknown> }
  | { step: 'tool_result'; result: string }
  | { step: 'final_response'; content: string }
  | { step: 'error'; error: string }
  | { step: 'no_tool_call'; content: string }

export type GenStep =
  | { step: 'status'; message: string }
  | { step: 'code_generated' }
  | { step: 'args_generated' }
  | { step: 'test_result'; success: boolean; result?: string; error?: string }
  | { step: 'definition_generated' }
  | { step: 'llm_step'; llmStep: LLMTestStep }
  | { step: 'error'; error: string }

interface UseSkillPlaygroundOptions {
  initialCode?: string
  initialArgs?: string
  initialDefinition?: string
  editingSkillId?: string
}

export function useSkillPlayground({
  initialCode,
  initialArgs,
  initialDefinition,
  editingSkillId,
}: UseSkillPlaygroundOptions = {}) {
  const [code, setCode] = useState(initialCode ?? '')
  const [testArgs, setTestArgs] = useState(initialArgs ?? '{\n  \n}')
  const [definition, setDefinition] = useState(initialDefinition ?? '')
  const [model, setModel] = useState('')

  // Step 1 state
  const [codeResult, setCodeResult] = useState<CodeTestResult | null>(null)
  const [codeRunning, setCodeRunning] = useState(false)

  // Step 2 state
  const [llmSteps, setLlmSteps] = useState<LLMTestStep[]>([])
  const [llmRunning, setLlmRunning] = useState(false)
  const [llmCompleted, setLlmCompleted] = useState(false)

  const codePassed = codeResult?.success === true

  const runCodeTest = useCallback(async () => {
    if (!code.trim()) return
    let parsedArgs: Record<string, unknown> = {}
    try {
      parsedArgs = JSON.parse(testArgs || '{}')
    } catch {
      setCodeResult({ success: false, error: 'Invalid JSON in test arguments' })
      return
    }

    setCodeRunning(true)
    setCodeResult(null)

    try {
      const res = await fetch('/api/skills/test-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, args: parsedArgs }),
      })
      const data = await res.json()
      setCodeResult(data)
    } catch (err) {
      setCodeResult({ success: false, error: `Connection error: ${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setCodeRunning(false)
    }
  }, [code, testArgs])

  const runLLMTest = useCallback(async () => {
    let parsedDef
    try {
      parsedDef = JSON.parse(definition)
    } catch {
      setLlmSteps([{ step: 'error', error: 'Invalid JSON definition' }])
      return
    }

    setLlmRunning(true)
    setLlmSteps([])
    setLlmCompleted(false)

    try {
      const res = await fetch('/api/skills/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definition: parsedDef, code, model: model || undefined }),
      })

      if (!res.ok || !res.body) {
        setLlmSteps([{ step: 'error', error: `Server error: ${res.status} ${res.statusText}` }])
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let lastEventType = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            lastEventType = line.slice(7)
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (lastEventType === 'test_step') {
                if (data.step === 'final_response') {
                  // Accumulate streaming final_response content into a single step
                  setLlmSteps((prev) => {
                    const last = prev[prev.length - 1]
                    if (last && last.step === 'final_response') {
                      return [...prev.slice(0, -1), { step: 'final_response', content: last.content + (data.content ?? '') }]
                    }
                    return [...prev, { step: 'final_response', content: data.content ?? '' }]
                  })
                } else {
                  setLlmSteps((prev) => [...prev, data as LLMTestStep])
                }
              } else if (lastEventType === 'test_error') {
                setLlmSteps((prev) => [...prev, { step: 'error', error: data.error } as LLMTestStep])
              } else if (lastEventType === 'test_done') {
                setLlmCompleted(true)
              }
            } catch {
              // Skip malformed data
            }
          }
        }
      }
    } catch (err) {
      setLlmSteps([{ step: 'error', error: `Connection error: ${err instanceof Error ? err.message : String(err)}` }])
    } finally {
      setLlmRunning(false)
    }
  }, [definition, code, model])

  const saveSkill = useCallback(async () => {
    try {
      const parsedDef = JSON.parse(definition)
      const handler = { type: 'code' as const, code }

      if (editingSkillId) {
        const res = await fetch(`/api/skills/${editingSkillId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ definition: parsedDef, handler }),
        })
        if (res.ok) return await res.json()
        return null
      }

      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definition: parsedDef, handler }),
      })
      if (res.ok) return await res.json()
      return null
    } catch {
      return null
    }
  }, [definition, code, editingSkillId])

  const resetCode = useCallback(() => {
    setCodeResult(null)
  }, [])

  const resetLLM = useCallback(() => {
    setLlmSteps([])
    setLlmCompleted(false)
  }, [])

  // Generation state
  const [genSteps, setGenSteps] = useState<GenStep[]>([])
  const [generating, setGenerating] = useState(false)
  const [genCompleted, setGenCompleted] = useState(false)

  const generateSkill = useCallback(async (prompt: string) => {
    setGenerating(true)
    setGenSteps([])
    setGenCompleted(false)
    setCodeResult(null)
    setLlmSteps([])
    setLlmCompleted(false)

    try {
      const res = await fetch('/api/skills/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model: model || undefined }),
      })

      if (!res.ok || !res.body) {
        setGenSteps([{ step: 'error', error: `Server error: ${res.status}` }])
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let lastEventType = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            lastEventType = line.slice(7)
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))

              if (lastEventType === 'gen_status') {
                setGenSteps((prev) => [...prev, { step: 'status', message: data.message }])
              } else if (lastEventType === 'gen_code') {
                setCode(data.code)
                setGenSteps((prev) => [...prev, { step: 'code_generated' }])
              } else if (lastEventType === 'gen_args') {
                setTestArgs(data.args)
                setGenSteps((prev) => [...prev, { step: 'args_generated' }])
              } else if (lastEventType === 'gen_test') {
                setGenSteps((prev) => [...prev, { step: 'test_result', success: data.success, result: data.result, error: data.error }])
                if (data.success) {
                  setCodeResult({ success: true, result: data.result })
                }
              } else if (lastEventType === 'gen_definition') {
                setDefinition(data.definition)
                setGenSteps((prev) => [...prev, { step: 'definition_generated' }])
              } else if (lastEventType === 'gen_llm_step') {
                const llmData = data as LLMTestStep
                if (llmData.step === 'final_response') {
                  setGenSteps((prev) => {
                    const last = prev[prev.length - 1]
                    if (last && last.step === 'llm_step' && last.llmStep.step === 'final_response') {
                      return [...prev.slice(0, -1), { step: 'llm_step', llmStep: { step: 'final_response', content: last.llmStep.content + (data.content ?? '') } }]
                    }
                    return [...prev, { step: 'llm_step', llmStep: { step: 'final_response', content: data.content ?? '' } }]
                  })
                  setLlmSteps((prev) => {
                    const last = prev[prev.length - 1]
                    if (last && last.step === 'final_response') {
                      return [...prev.slice(0, -1), { step: 'final_response', content: last.content + (data.content ?? '') } as LLMTestStep]
                    }
                    return [...prev, { step: 'final_response', content: data.content ?? '' } as LLMTestStep]
                  })
                } else {
                  setGenSteps((prev) => [...prev, { step: 'llm_step', llmStep: llmData }])
                  setLlmSteps((prev) => [...prev, llmData])
                }
              } else if (lastEventType === 'gen_error') {
                setGenSteps((prev) => [...prev, { step: 'error', error: data.error }])
              } else if (lastEventType === 'gen_done') {
                setGenCompleted(true)
              }
            } catch {
              // Skip malformed data
            }
          }
        }
      }
    } catch (err) {
      setGenSteps([{ step: 'error', error: `Connection error: ${err instanceof Error ? err.message : String(err)}` }])
    } finally {
      setGenerating(false)
    }
  }, [model])

  const resetGen = useCallback(() => {
    setGenSteps([])
    setGenCompleted(false)
  }, [])

  return {
    code,
    setCode,
    testArgs,
    setTestArgs,
    definition,
    setDefinition,
    model,
    setModel,
    codeResult,
    codeRunning,
    codePassed,
    runCodeTest,
    llmSteps,
    llmRunning,
    llmCompleted,
    runLLMTest,
    saveSkill,
    resetCode,
    resetLLM,
    genSteps,
    generating,
    genCompleted,
    generateSkill,
    resetGen,
  }
}