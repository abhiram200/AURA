import { useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import type { OllamaModel } from '../../hooks/useSettings'
import type { SkillEntry } from '../../hooks/useSkills'
import type { LLMTestStep, GenStep } from '../../hooks/useSkillPlayground'
import { ModelSelector } from '../chat/ModelSelector'
import { CodeEditor } from './CodeEditor'
import { useSkillPlayground } from '../../hooks/useSkillPlayground'
import { useAnimationConfig } from '../../hooks/useAnimationConfig'
import { getTransition } from '../../hooks/useAnimationConfig'

const EXAMPLE_CODE = `// 'args' contains the tool call arguments
// Return a string as the result
`

const EXAMPLE_ARGS = `{
  "key": "value"
}`

const EXAMPLE_JSON = `{
  "type": "function",
  "function": {
    "name": "my_tool",
    "description": "What this tool does",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  }
}`

interface SkillPlaygroundProps {
  onClose: () => void
  onSaved: () => void
  models: OllamaModel[]
  defaultModel: string
  editSkill?: SkillEntry
}

export function SkillPlayground({ onClose, onSaved, models, defaultModel, editSkill }: SkillPlaygroundProps) {
  const {
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
  } = useSkillPlayground({
    initialCode: editSkill?.handler.type === 'code' ? editSkill.handler.code : undefined,
    initialDefinition: editSkill ? JSON.stringify(editSkill.definition, null, 2) : undefined,
    editingSkillId: editSkill?.id,
  })

  const { animationIntensity } = useAnimationConfig()
  const overlayTransition = getTransition(0.2, animationIntensity)
  const panelTransition = getTransition({ type: 'spring', stiffness: 300, damping: 30 }, animationIntensity)
  const terminalRef = useRef<HTMLDivElement>(null)

  const [activeTab, setActiveTab] = useState<'handler' | 'args' | 'definition'>('handler')
  const [hasEditedFromEdit, setHasEditedFromEdit] = useState(false)
  const [showGenPrompt, setShowGenPrompt] = useState(false)
  const [genPrompt, setGenPrompt] = useState('')
  const hasFinalResponse = llmSteps.some((s) => s.step === 'final_response')
  const hasLLMError = llmSteps.some((s) => s.step === 'error')

  // When editing a skill, show definition tab until user edits handler/args
  const showDefinition = codePassed || (!!editSkill && !hasEditedFromEdit)

  const handleCodeChange = (v: string) => {
    setCode(v)
    resetCode()
    if (editSkill && !hasEditedFromEdit) {
      setHasEditedFromEdit(true)
      if (activeTab === 'definition' && !codePassed) setActiveTab('handler')
    }
  }

  const handleArgsChange = (v: string) => {
    setTestArgs(v)
    resetCode()
    if (editSkill && !hasEditedFromEdit) {
      setHasEditedFromEdit(true)
      if (activeTab === 'definition' && !codePassed) setActiveTab('handler')
    }
  }

  const scrollToTerminalBottom = () => {
    setTimeout(() => terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight, behavior: 'smooth' }), 100)
  }

  // Auto-scroll terminal during generation
  useEffect(() => {
    if (genSteps.length > 0) scrollToTerminalBottom()
  }, [genSteps.length])

  // Auto-switch tabs during generation
  useEffect(() => {
    if (!generating || genSteps.length === 0) return
    const lastStep = genSteps[genSteps.length - 1]
    if (lastStep.step === 'code_generated') setActiveTab('handler')
    else if (lastStep.step === 'args_generated') setActiveTab('args')
    else if (lastStep.step === 'definition_generated') setActiveTab('definition')
  }, [generating, genSteps.length])

  const handleRunCode = async () => {
    await runCodeTest()
    scrollToTerminalBottom()
  }

  const handleLLMTest = async () => {
    await runLLMTest()
    scrollToTerminalBottom()
  }

  const handleSave = async () => {
    const saved = await saveSkill()
    if (saved) onSaved()
  }

  const showOutput = codeResult !== null || llmSteps.length > 0 || codeRunning || llmRunning || genSteps.length > 0 || generating

  return (
    <AnimatePresence>
      <motion.div
        className="pg-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={overlayTransition}
        onClick={onClose}
      />
      <motion.div
        className="pg"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        transition={panelTransition}
      >
        {/* Title bar */}
        <div className="pg__bar">
          <div className="pg__bar-left">
            <span className="pg__logo">⬡</span>
            <span className="pg__title">{editSkill ? `Edit: ${editSkill.name}` : 'Skill Playground'}</span>
          </div>
          <div className="pg__bar-right">
            <ModelSelector
              models={models}
              currentModel={model || defaultModel}
              onModelChange={setModel}
            />
            {!generating && (
              <button className="pg__btn pg__btn--gen" onClick={() => setShowGenPrompt(!showGenPrompt)}>
                Generate with AI
              </button>
            )}
            {hasFinalResponse && (
              <button className="pg__btn pg__btn--save" onClick={handleSave}>
                {editSkill ? 'Update Skill' : 'Save Skill'}
              </button>
            )}
            <button className="pg__btn pg__btn--ghost" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="pg__tabs">
          <button
            className={`pg__tab${activeTab === 'handler' ? ' pg__tab--active' : ''}`}
            onClick={() => setActiveTab('handler')}
          >
            handler.js
            {codePassed && <span className="pg__tab-badge pg__tab-badge--ok">✓</span>}
          </button>
          <button
            className={`pg__tab${activeTab === 'args' ? ' pg__tab--active' : ''}`}
            onClick={() => setActiveTab('args')}
          >
            args.json
          </button>
          {showDefinition && (
            <button
              className={`pg__tab${activeTab === 'definition' ? ' pg__tab--active' : ''}`}
              onClick={() => setActiveTab('definition')}
            >
              tool.json
            </button>
          )}
          <div className="pg__tab-actions">
            {(activeTab === 'handler' || activeTab === 'args') && (
              <button className="pg__btn pg__btn--accent" onClick={handleRunCode} disabled={codeRunning || !code.trim()}>
                {codeRunning ? 'Running...' : '▶ Run'}
              </button>
            )}
            {activeTab === 'definition' && showDefinition && (
              <button className="pg__btn pg__btn--accent" onClick={handleLLMTest} disabled={llmRunning || !definition.trim()}>
                {llmRunning ? 'Testing...' : '▶ Test with LLM'}
              </button>
            )}
          </div>
        </div>

        {/* AI Generation prompt bar */}
        <AnimatePresence>
          {(showGenPrompt || generating) && (
            <motion.div
              className="pg__gen-bar"
              key="gen-bar"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {generating ? (
                <div className="pg__gen-bar-inner pg__gen-bar-inner--active">
                  <span className="playground__loading-spinner" />
                  <span className="pg__gen-bar-status">
                    {genSteps.length > 0 && genSteps[genSteps.length - 1].step === 'status'
                      ? (genSteps[genSteps.length - 1] as { step: 'status'; message: string }).message
                      : 'Generating...'}
                  </span>
                </div>
              ) : (
                <div className="pg__gen-bar-inner">
                  <input
                    className="pg__gen-input"
                    placeholder="Describe what you need this skill to do..."
                    value={genPrompt}
                    onChange={(e) => setGenPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && genPrompt.trim() && !generating) {
                        generateSkill(genPrompt.trim())
                        setShowGenPrompt(false)
                      }
                    }}
                    autoFocus
                  />
                  <button
                    className="pg__btn pg__btn--accent"
                    disabled={!genPrompt.trim()}
                    onClick={() => {
                      if (genPrompt.trim()) {
                        generateSkill(genPrompt.trim())
                        setShowGenPrompt(false)
                      }
                    }}
                  >
                    Generate
                  </button>
                  <button className="pg__btn pg__btn--ghost" onClick={() => { setShowGenPrompt(false); setGenPrompt('') }}>
                    Cancel
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Content area — editor on top, terminal below */}
        <div className="pg__workspace">
          <div className="pg__editor-area">
            <AnimatePresence mode="wait">
              {activeTab === 'handler' && (
                <motion.div key="handler" className="pg__editor-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                  <CodeEditor value={code} onChange={handleCodeChange} language="javascript" placeholder={EXAMPLE_CODE} minLines={16} />
                </motion.div>
              )}

              {activeTab === 'args' && (
                <motion.div key="args" className="pg__editor-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                  <CodeEditor value={testArgs} onChange={handleArgsChange} language="json" placeholder={EXAMPLE_ARGS} minLines={16} />
                </motion.div>
              )}

              {activeTab === 'definition' && (
                <motion.div key="def" className="pg__editor-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                  <CodeEditor value={definition} onChange={(v) => { setDefinition(v); resetLLM() }} language="json" placeholder={EXAMPLE_JSON} minLines={16} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Terminal — always shown below, like VS Code */}
          <div className="pg__terminal">
            <div className="pg__terminal-bar">
              <span className="pg__terminal-title">Output</span>
            </div>
            <div className="pg__terminal-body" ref={terminalRef}>
              {!showOutput && (
                <div className="pg__terminal-empty">
                  <span className="pg__terminal-cursor">▊</span> Run code, test with LLM, or generate with AI.
                </div>
              )}
              {genSteps.length > 0 && genSteps.map((step, i) => (
                <GenStepCard key={`gen-${i}`} step={step} isLastStep={i === genSteps.length - 1} generating={generating} />
              ))}
              {generating && genSteps.length === 0 && (
                <div className="pg__term-line pg__term-line--muted">
                  <span className="playground__loading-spinner" /> Starting generation...
                </div>
              )}
              {genSteps.length === 0 && !generating && codeRunning && !codeResult && (
                <div className="pg__term-line pg__term-line--muted">
                  <span className="playground__loading-spinner" /> Running handler...
                </div>
              )}
              {genSteps.length === 0 && codeResult && (
                <div className={`pg__term-line ${codeResult.success ? 'pg__term-line--ok' : 'pg__term-line--err'}`}>
                  <span className="pg__term-prompt">{codeResult.success ? '✓' : '✕'}</span> {codeResult.success ? 'Output' : 'Error'}
                  <pre className="pg__term-out">{codeResult.success ? codeResult.result : codeResult.error}</pre>
                </div>
              )}
              {genSteps.length === 0 && llmRunning && llmSteps.length === 0 && (
                <div className="pg__term-line pg__term-line--muted">
                  <span className="playground__loading-spinner" /> Calling model...
                </div>
              )}
              {genSteps.length === 0 && llmSteps.map((step, i) => (
                <LLMStepCard key={i} step={step} />
              ))}
              {genSteps.length === 0 && llmRunning && llmSteps.some((s) => s.step === 'llm_thinking') && !llmSteps.some((s) => s.step === 'tool_call' || s.step === 'final_response' || s.step === 'error') && (
                <div className="pg__term-line pg__term-line--muted">
                  <span className="playground__loading-spinner" /> Thinking...
                </div>
              )}
              {genSteps.length === 0 && llmRunning && llmSteps.some((s) => s.step === 'tool_result') && !llmSteps.some((s) => s.step === 'final_response') && (
                <div className="pg__term-line pg__term-line--muted">
                  <span className="playground__loading-spinner" /> Generating response...
                </div>
              )}
              {genSteps.length === 0 && hasLLMError && (
                <button className="pg__btn pg__btn--accent" onClick={resetLLM} style={{ marginTop: 8 }}>
                  Retry
                </button>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

function LLMStepCard({ step }: { step: LLMTestStep }) {
  switch (step.step) {
    case 'definition_validated':
      return <div className="pg__term-line pg__term-line--ok"><span className="pg__term-prompt">✓</span> Definition validated</div>
    case 'code_compiled':
      return <div className="pg__term-line pg__term-line--ok"><span className="pg__term-prompt">✓</span> Code compiled</div>
    case 'llm_thinking':
      return null
    case 'tool_call':
      return (
        <div className="pg__term-line pg__term-line--warn">
          <span className="pg__term-prompt">⚡</span> <strong>{step.name}</strong>
          <pre className="pg__term-out">{JSON.stringify(step.args, null, 2)}</pre>
        </div>
      )
    case 'tool_result':
      return (
        <div className="pg__term-line pg__term-line--info">
          <span className="pg__term-prompt">↳</span> Result:
          <pre className="pg__term-out">{step.result}</pre>
        </div>
      )
    case 'final_response':
      return (
        <div className="pg__term-line pg__term-line--ok">
          <span className="pg__term-prompt">✦</span> <strong>Final Response</strong>
          <div className="pg__term-out pg__term-out--block">{step.content}</div>
        </div>
      )
    case 'error':
      return <div className="pg__term-line pg__term-line--err"><span className="pg__term-prompt">✕</span> {step.error}</div>
    case 'no_tool_call':
      return <div className="pg__term-line pg__term-line--err"><span className="pg__term-prompt">✕</span> No tool call — {step.content}</div>
  }
}

function GenStepCard({ step, isLastStep, generating }: { step: GenStep; isLastStep: boolean; generating: boolean }) {
  switch (step.step) {
    case 'status':
      const active = isLastStep && generating
      return (
        <div className={`pg__term-line ${active ? 'pg__term-line--muted' : 'pg__term-line--ok'}`}>
          {active
            ? <span className="playground__loading-spinner" />
            : <span className="pg__term-prompt">✓</span>
          } {step.message}
        </div>
      )
    case 'code_generated':
      return <div className="pg__term-line pg__term-line--ok"><span className="pg__term-prompt">✓</span> Handler code generated</div>
    case 'args_generated':
      return <div className="pg__term-line pg__term-line--ok"><span className="pg__term-prompt">✓</span> Test arguments generated</div>
    case 'test_result':
      return step.success
        ? <div className="pg__term-line pg__term-line--ok"><span className="pg__term-prompt">✓</span> Handler test passed<pre className="pg__term-out">{step.result}</pre></div>
        : <div className="pg__term-line pg__term-line--err"><span className="pg__term-prompt">✕</span> Handler test failed<pre className="pg__term-out">{step.error}</pre></div>
    case 'definition_generated':
      return <div className="pg__term-line pg__term-line--ok"><span className="pg__term-prompt">✓</span> Tool definition generated</div>
    case 'llm_step':
      return <LLMStepCard step={step.llmStep} />
    case 'error':
      return <div className="pg__term-line pg__term-line--err"><span className="pg__term-prompt">✕</span> {step.error}</div>
  }
}