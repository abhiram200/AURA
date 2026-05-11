import { Router } from 'express'
import { SKILL_TOOL_USE, SKILL_CODE_GENERATOR, SKILL_ARGS_GENERATOR, SKILL_ERROR_FIXER, SKILL_DEFINITION_GENERATOR, TOOL_RELAY_INSTRUCTION } from '../prompts.ts'
import type { SkillsService } from '../services/skills.ts'
import type { OllamaService } from '../services/ollama.ts'
import type { FileStore } from '../storage/fileStore.ts'
import type { SkillDefinition, Settings } from '../storage/types.ts'

export function createSkillsRouter(
  skillsService: SkillsService,
  ollama: OllamaService,
  store: FileStore,
) {
  const router = Router()

  router.get('/', async (_req, res) => {
    const skills = await skillsService.list()
    res.json({ skills })
  })

  router.post('/', async (req, res) => {
    const { definition, handler } = req.body as { definition: SkillDefinition; handler: Record<string, unknown> }
    if (!definition || !handler) {
      res.status(400).json({ error: 'definition and handler are required' })
      return
    }
    const skill = await skillsService.add(definition, handler as any)
    res.status(201).json(skill)
  })

  router.post('/test-code', async (req, res) => {
    const { code, args } = req.body as { code: string; args?: Record<string, unknown> }

    if (!code) {
      res.status(400).json({ error: 'code is required' })
      return
    }

    try {
      const result = await skillsService.executeCode(code, args ?? {})
      res.json({ success: true, result })
    } catch (err) {
      res.json({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/test', async (req, res) => {
    const { definition, code, model } = req.body as {
      definition: SkillDefinition
      code: string
      model?: string
    }

    if (!definition || !code) {
      res.status(400).json({ error: 'definition and code are required' })
      return
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const sendSSE = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    try {
      // Step 1: Validate definition
      if (!definition.function?.name || !definition.function?.description) {
        sendSSE('test_error', { step: 'definition', error: 'Definition must have function.name and function.description' })
        res.end()
        return
      }
      sendSSE('test_step', { step: 'definition_validated' })

      // Step 2: Compile code
      try {
        new Function('args', code)
      } catch (err) {
        sendSSE('test_error', { step: 'code', error: `Code compilation failed: ${err instanceof Error ? err.message : String(err)}` })
        res.end()
        return
      }
      sendSSE('test_step', { step: 'code_compiled' })

      // Step 3: Call Ollama with the tool definition
      const settings = await store.read<Settings>('settings.json')
      const modelToUse = model || settings?.defaultModel || 'llama3.2'

      const toolDef = definition
      const userMessage = `Please use the ${definition.function.name} tool. ${definition.function.description}`

      const stream = await ollama.chatStream({
        model: modelToUse,
        messages: [
          { role: 'system', content: SKILL_TOOL_USE },
          { role: 'user', content: userMessage },
        ],
        stream: true,
        tools: [toolDef],
        think: true,
      })

      let fullResponse = ''
      let fullThinking = ''
      let toolCalls: { function: { name: string; arguments: Record<string, unknown> } }[] = []
      const reader = stream.getReader()
      const decoder = new TextDecoder()

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const text = decoder.decode(value, { stream: true })
          const lines = text.split('\n').filter((l) => l.trim())

          for (const line of lines) {
            try {
              const parsed = JSON.parse(line)
              const thinking = parsed.message?.thinking ?? ''
              const content = parsed.message?.content ?? ''

              if (thinking) {
                fullThinking += thinking
                sendSSE('test_step', { step: 'llm_thinking', content: thinking })
              }

              if (content) {
                fullResponse += content
              }

              if (parsed.message?.tool_calls) {
                toolCalls = parsed.message.tool_calls
              }
            } catch {
              // Skip malformed lines
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      // Step 4: Handle tool call or no tool call
      if (toolCalls.length === 0) {
        sendSSE('test_error', { step: 'no_tool_call', content: fullResponse || 'The model did not call the tool. Try adjusting the description or model.' })
        res.end()
        return
      }

      for (const toolCall of toolCalls) {
        const skillName = toolCall.function.name
        const args = toolCall.function.arguments

        sendSSE('test_step', { step: 'tool_call', name: skillName, args })

        // Step 5: Execute the user's code
        let toolResult: string
        try {
          toolResult = await skillsService.executeCode(code, args)
        } catch (err) {
          toolResult = `Error: ${err instanceof Error ? err.message : String(err)}`
        }

        sendSSE('test_step', { step: 'tool_result', result: toolResult })

        // Step 6: Send result back to LLM for final response (streamed)
        const finalStream = await ollama.chatStream({
          model: modelToUse,
          messages: [
            { role: 'system', content: SKILL_TOOL_USE },
            { role: 'user', content: userMessage },
            { role: 'assistant', content: fullResponse, tool_calls: toolCalls },
            { role: 'tool', tool_name: skillName, content: toolResult },
            { role: 'user', content: TOOL_RELAY_INSTRUCTION },
          ],
          stream: true,
        })

        const finalReader = finalStream.getReader()
        const finalDecoder = new TextDecoder()
        let finalBuffer = ''

        try {
          while (true) {
            const { done, value } = await finalReader.read()
            if (done) break

            finalBuffer += finalDecoder.decode(value, { stream: true })
            const finalLines = finalBuffer.split('\n').filter((l) => l.trim())
            finalBuffer = ''

            for (const line of finalLines) {
              try {
                const parsed = JSON.parse(line)
                const content = parsed.message?.content ?? ''
                if (content) {
                  sendSSE('test_step', { step: 'final_response', content })
                }
              } catch {
                // Skip malformed lines
              }
            }
          }
        } finally {
          finalReader.releaseLock()
        }
      }

      sendSSE('test_done', {})
    } catch (err) {
      sendSSE('test_error', { step: 'runtime', error: err instanceof Error ? err.message : String(err) })
    }

    res.end()
  })

  router.post('/test-api', async (req, res) => {
    const { url, method } = req.body as { url: string; method?: string }
    if (!url) {
      res.status(400).json({ success: false, error: 'url is required' })
      return
    }

    const httpMethod = (method || 'GET').toUpperCase()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    try {
      const useMethod = httpMethod === 'GET' ? 'GET' : httpMethod
      const fetchOptions: RequestInit = {
        method: useMethod,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
      }

      if (['POST', 'PUT', 'DELETE'].includes(httpMethod)) {
        fetchOptions.body = JSON.stringify({})
      }

      const response = await fetch(url, fetchOptions)

      let body = ''
      try {
        const text = await response.text()
        body = text.length > 500 ? text.slice(0, 500) + '...' : text
      } catch {
        body = ''
      }

      res.json({
        success: true,
        status: response.status,
        statusText: response.statusText,
        body,
      })
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Request timed out (10s)'
          : err instanceof Error
            ? err.message
            : String(err)
      res.json({ success: false, error: `Connection failed: ${message}` })
    } finally {
      clearTimeout(timeout)
    }
  })

  router.put('/:id', async (req, res) => {
    const updates = req.body as { definition?: SkillDefinition; handler?: Record<string, unknown>; active?: boolean; locked?: boolean }
    const skill = await skillsService.update(req.params.id, updates as any)
    if (!skill) {
      res.status(404).json({ error: 'Skill not found' })
      return
    }
    res.json(skill)
  })

  router.delete('/:id', async (req, res) => {
    if (req.params.id.startsWith('builtin_')) {
      res.status(403).json({ error: 'Built-in skills cannot be deleted' })
      return
    }
    const skill = await skillsService.list()
    const entry = skill.find((s) => s.id === req.params.id)
    const force = req.query.force === 'true'
    if (entry?.locked && !force) {
      res.status(403).json({ error: 'Locked skills cannot be deleted. Use force=true to override.' })
      return
    }
    await skillsService.delete(req.params.id)
    res.status(204).end()
  })

  router.delete('/', async (_req, res) => {
    await skillsService.deleteAll()
    res.status(204).end()
  })

  // AI Skill Generation — streams the full workflow via SSE
  router.post('/generate', async (req, res) => {
    const { prompt, model } = req.body as { prompt: string; model?: string }

    if (!prompt) {
      res.status(400).json({ error: 'prompt is required' })
      return
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    const stripFences = (s: string) =>
      s.replace(/^```(?:javascript|js|json)?\n?/i, '').replace(/\n?```$/,'').trim()

    const collectStream = async (stream: ReadableStream<Uint8Array>) => {
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      let result = ''
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          result += decoder.decode(value, { stream: true })
        }
      } finally {
        reader.releaseLock()
      }
      return result
    }

    const parseStreamedJSON = (raw: string) => {
      let content = ''
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        try {
          const parsed = JSON.parse(line)
          content += parsed.message?.content ?? ''
        } catch { /* skip */ }
      }
      return content
    }

    try {
      const settings = await store.read<Settings>('settings.json')
      const modelToUse = model || settings?.defaultModel || 'llama3.2'

      // Step 1: Generate handler code
      send('gen_status', { message: 'Generating handler code...' })

      const codeRes = await ollama.chat({
        model: modelToUse,
        messages: [
          { role: 'system', content: SKILL_CODE_GENERATOR },
          { role: 'user', content: `Create a JavaScript handler for this tool: ${prompt}\n\nThe code will be executed as: new Function('args', yourCode)(args)\nIt receives args as an object and MUST return a string.\nEvery code path needs an explicit return statement.\nWrap everything in try/catch.\n\nOutput ONLY the JavaScript code. No markdown, no fences, no explanation.` }
        ]
      })

      let handlerCode = stripFences(codeRes.message?.content ?? '')
      send('gen_code', { code: handlerCode })

      // Step 2: Generate test arguments
      send('gen_status', { message: 'Generating test arguments...' })

      const argsRes = await ollama.chat({
        model: modelToUse,
        messages: [
          { role: 'system', content: SKILL_ARGS_GENERATOR },
          { role: 'user', content: `For this tool: "${prompt}"\nHandler code:\n${handlerCode}\n\nGenerate a realistic sample args JSON object for testing this handler. Keys must exactly match what the handler accesses in args. Values should be realistic test data.\n\nOutput ONLY the JSON object. No markdown, no fences.` }
        ]
      })

      let argsJson = stripFences(argsRes.message?.content ?? '{}')
      let parsedArgs: Record<string, unknown> = {}
      try {
        parsedArgs = JSON.parse(argsJson)
        argsJson = JSON.stringify(parsedArgs, null, 2)
      } catch {
        argsJson = '{\n  \n}'
      }

      send('gen_args', { args: argsJson })

      // Step 3: Test the handler, auto-fix errors
      send('gen_status', { message: 'Testing handler...' })

      let currentCode = handlerCode
      const maxFixAttempts = 2

      for (let attempt = 0; attempt <= maxFixAttempts; attempt++) {
        try {
          new Function('args', currentCode)
          const result = await skillsService.executeCode(currentCode, parsedArgs)
          send('gen_test', { success: true, result })
          handlerCode = currentCode
          break
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          send('gen_test', { success: false, error: errMsg })

          if (attempt < maxFixAttempts) {
            send('gen_status', { message: `Fixing errors (attempt ${attempt + 1}/${maxFixAttempts})...` })

            const fixRes = await ollama.chat({
              model: modelToUse,
              messages: [
                { role: 'system', content: SKILL_ERROR_FIXER },
                { role: 'user', content: `Error:\n${errMsg}\n\nCode:\n${currentCode}\n\nFix the error. Remember: the code is executed as new Function('args', code)(args) and MUST return a string from every code path. Wrap in try/catch. Output ONLY the fixed JavaScript code. No markdown, no fences.` }
              ]
            })

            currentCode = stripFences(fixRes.message?.content ?? '')
            send('gen_code', { code: currentCode })
          }
        }
      }

      // Step 4: Generate tool definition
      send('gen_status', { message: 'Generating tool definition...' })

      const defRes = await ollama.chat({
        model: modelToUse,
        messages: [
          { role: 'system', content: SKILL_DEFINITION_GENERATOR },
          { role: 'user', content: `For this tool: "${prompt}"\nHandler code:\n${handlerCode}\n\nGenerate an OpenAI function-calling tool definition JSON. The function name must be lowercase snake_case. The description must be specific enough for an LLM to decide when to call this tool. Every parameter property MUST have a description. The required array must list all parameters the handler needs. Parameter names must exactly match what the handler accesses in args.\n\nOutput ONLY the JSON object. No markdown, no fences.` }
        ]
      })

      let defJson = stripFences(defRes.message?.content ?? '')
      let parsedDef: SkillDefinition | null = null
      try {
        parsedDef = JSON.parse(defJson)
        if (!parsedDef.function?.name || !parsedDef.function?.description) {
          throw new Error('Missing function.name or function.description')
        }
        defJson = JSON.stringify(parsedDef, null, 2)
      } catch (err) {
        send('gen_error', { error: `Invalid tool definition: ${err instanceof Error ? err.message : String(err)}` })
      }

      send('gen_definition', { definition: defJson })

      // Step 5: Full LLM test (if definition is valid)
      if (parsedDef?.function?.name) {
        send('gen_status', { message: 'Testing with LLM...' })

        send('gen_llm_step', { step: 'definition_validated' })

        try {
          new Function('args', handlerCode)
          send('gen_llm_step', { step: 'code_compiled' })
        } catch (err) {
          send('gen_llm_step', { step: 'error', error: `Code compilation failed: ${err instanceof Error ? err.message : String(err)}` })
          send('gen_done', {})
          res.end()
          return
        }

        const userMessage = `Please use the ${parsedDef.function.name} tool. ${parsedDef.function.description}`

        const stream = await ollama.chatStream({
          model: modelToUse,
          messages: [
            { role: 'system', content: SKILL_TOOL_USE },
            { role: 'user', content: userMessage },
          ],
          stream: true,
          tools: [parsedDef],
          think: true,
        })

        let fullResponse = ''
        let toolCalls: { function: { name: string; arguments: Record<string, unknown> } }[] = []
        const reader = stream.getReader()
        const decoder = new TextDecoder()

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const text = decoder.decode(value, { stream: true })
            const lines = text.split('\n').filter((l: string) => l.trim())

            for (const line of lines) {
              try {
                const parsed = JSON.parse(line)
                const thinking = parsed.message?.thinking ?? ''
                const content = parsed.message?.content ?? ''

                if (thinking) send('gen_llm_step', { step: 'llm_thinking', content: thinking })
                if (content) fullResponse += content
                if (parsed.message?.tool_calls) toolCalls = parsed.message.tool_calls
              } catch { /* skip */ }
            }
          }
        } finally {
          reader.releaseLock()
        }

        if (toolCalls.length === 0) {
          send('gen_llm_step', { step: 'no_tool_call', content: fullResponse || 'The model did not call the tool.' })
        } else {
          for (const toolCall of toolCalls) {
            const skillName = toolCall.function.name
            const callArgs = toolCall.function.arguments

            send('gen_llm_step', { step: 'tool_call', name: skillName, args: callArgs })

            let toolResult: string
            try {
              toolResult = await skillsService.executeCode(handlerCode, callArgs)
            } catch (err) {
              toolResult = `Error: ${err instanceof Error ? err.message : String(err)}`
            }

            send('gen_llm_step', { step: 'tool_result', result: toolResult })

            const finalStream = await ollama.chatStream({
              model: modelToUse,
              messages: [
                { role: 'system', content: SKILL_TOOL_USE },
                { role: 'user', content: userMessage },
                { role: 'assistant', content: fullResponse, tool_calls: toolCalls },
                { role: 'tool', tool_name: skillName, content: toolResult },
                { role: 'user', content: TOOL_RELAY_INSTRUCTION },
              ],
              stream: true,
            })

            const finalReader = finalStream.getReader()
            const finalDecoder = new TextDecoder()
            let finalBuffer = ''

            try {
              while (true) {
                const { done, value } = await finalReader.read()
                if (done) break

                finalBuffer += finalDecoder.decode(value, { stream: true })
                const finalLines = finalBuffer.split('\n').filter((l: string) => l.trim())
                finalBuffer = ''

                for (const line of finalLines) {
                  try {
                    const parsed = JSON.parse(line)
                    const content = parsed.message?.content ?? ''
                    if (content) send('gen_llm_step', { step: 'final_response', content })
                  } catch { /* skip */ }
                }
              }
            } finally {
              finalReader.releaseLock()
            }
          }
        }
      }

      send('gen_done', {})
    } catch (err) {
      send('gen_error', { error: err instanceof Error ? err.message : String(err) })
    }

    res.end()
  })

  return router
}