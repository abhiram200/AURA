import { execSync, spawn } from 'child_process'
import { platform } from 'os'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { createInterface } from 'readline'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')
const GRAMMARS_DIR = path.join(ROOT, 'server', 'grammars')

const GRAMMAR_SOURCES = [
  { name: 'tree-sitter-javascript.wasm', pkg: 'tree-sitter-javascript' },
  { name: 'tree-sitter-typescript.wasm', pkg: 'tree-sitter-typescript' },
  { name: 'tree-sitter-tsx.wasm', pkg: 'tree-sitter-typescript' },
  { name: 'tree-sitter-python.wasm', pkg: 'tree-sitter-python' },
  { name: 'tree-sitter-html.wasm', pkg: 'tree-sitter-html' },
  { name: 'tree-sitter-css.wasm', pkg: 'tree-sitter-css' },
  // tree-sitter-scss WASM must be built: npx tree-sitter build --wasm node_modules/tree-sitter-scss
  { name: 'tree-sitter-scss.wasm', pkg: 'tree-sitter-scss', build: true },
  { name: 'tree-sitter-php.wasm', pkg: 'tree-sitter-php' },
  { name: 'tree-sitter-java.wasm', pkg: 'tree-sitter-java' },
  { name: 'tree-sitter-c.wasm', pkg: 'tree-sitter-c' },
  { name: 'tree-sitter-cpp.wasm', pkg: 'tree-sitter-cpp' },
  { name: 'tree-sitter-c_sharp.wasm', pkg: 'tree-sitter-c-sharp' },
  { name: 'tree-sitter-go.wasm', pkg: 'tree-sitter-go' },
  { name: 'tree-sitter-rust.wasm', pkg: 'tree-sitter-rust' },
  // tree-sitter-vue has an external scanner incompatible with WASM — Vue SFC
  // blocks are parsed using regex extraction + sub-parsing with JS/TS/CSS/SCSS grammars
]

const REQUIRED_MODELS = ['glm-5.1:cloud', 'mxbai-embed-large']

function log(msg) {
  console.log(`  ${msg}`)
}

function warn(msg) {
  console.warn(`  ⚠️  ${msg}`)
}

function error(msg) {
  console.error(`  ❌ ${msg}`)
}

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', ...opts })
  } catch {
    return null
  }
}

function runInherit(cmd) {
  try {
    execSync(cmd, { encoding: 'utf-8', stdio: 'inherit' })
    return true
  } catch {
    return false
  }
}

function askQuestion(query) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase())
    })
  })
}

// ── Crawl4AI Setup ────────────────────────────────────────────────────────────

async function setupCrawl4AI() {
  console.log('\n  ╔══════════════════════════════════════╗')
  console.log('  ║     Crawl4AI Setup                   ║')
  console.log('  ╚══════════════════════════════════════╝\n')

  if (!run('pip install crawl4ai', 'Install crawl4ai')) {
    error('Failed to install crawl4ai. Skipping remaining Crawl4AI steps.')
    return false
  }

  if (!run('crawl4ai-setup', 'crawl4ai-setup')) {
    error('crawl4ai-setup failed.')
    return false
  }

  console.log('\n[crawl4ai-doctor] Running health check...')
  try {
    execSync('crawl4ai-doctor', { stdio: 'inherit', timeout: 120_000 })
    console.log('\n✓ Crawl4AI setup complete — all health checks passed.')
  } catch {
    console.warn('\n⚠ crawl4ai-doctor reported issues. Installing Playwright Chromium as fallback...')
    if (runInherit('python -m playwright install --with-deps chromium')) {
      console.log('\n✓ Playwright Chromium installed. Crawl4AI should work with this fallback.')
    } else {
      console.error('\n✗ Playwright Chromium installation also failed. You may need to install it manually.')
    }
  }

  return true
}

// ── Aura Setup ────────────────────────────────────────────────────────────

function copyGrammars() {
  console.log('\n  ╔══════════════════════════════════════╗')
  console.log('  ║     Aura Setup                    ║')
  console.log('  ╚══════════════════════════════════════╝\n')

  if (!fs.existsSync(GRAMMARS_DIR)) {
    fs.mkdirSync(GRAMMARS_DIR, { recursive: true })
  }

  log('Copying Tree-sitter grammars...')
  for (const entry of GRAMMAR_SOURCES) {
    const { name, pkg } = entry
    const build = entry.build ?? false
    const src = path.join(ROOT, 'node_modules', pkg, name)
    const dest = path.join(GRAMMARS_DIR, name)

    if (fs.existsSync(dest)) {
      log(`  Grammar ${name} already present`)
    } else if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest)
      log(`  Copied grammar: ${name}`)
    } else if (build) {
      // Grammar must be built with tree-sitter CLI (e.g., tree-sitter-scss has no pre-built WASM)
      warn(`Grammar ${name} not found in package — build it manually:`)
      warn(`  npx tree-sitter build --wasm node_modules/${pkg}`)
      warn(`  Then move the resulting .wasm file to ${dest}`)
    } else {
      warn(`Grammar source not found: ${src}`)
      warn(`Make sure '${pkg}' is installed (npm install) and re-run setup`)
    }
  }

  console.log('')
  log('✓ Aura grammars ready')
}

function isOllamaInstalled() {
  return run('ollama --version') !== null
}

function isOllamaRunning() {
  return run('ollama list') !== null
}

function installOllama() {
  const os = platform()

  if (os === 'win32') {
    log('Installing Ollama via winget...')
    const result = runInherit('winget install Ollama.Ollama --accept-source-agreements --accept-package-agreements')
    if (!result) {
      error('Could not install Ollama via winget.')
      error('Please install Ollama manually from https://ollama.com/download')
      return false
    }
  } else if (os === 'darwin') {
    log('Installing Ollama via Homebrew...')
    const result = runInherit('brew install ollama')
    if (!result) {
      error('Could not install Ollama via Homebrew.')
      error('Please install Ollama manually from https://ollama.com/download')
      return false
    }
  } else {
    log('Installing Ollama via official install script...')
    const result = runInherit('curl -fsSL https://ollama.com/install.sh | sh')
    if (!result) {
      error('Could not install Ollama.')
      error('Please install Ollama manually from https://ollama.com/download')
      return false
    }
  }

  if (!isOllamaInstalled()) {
    error('Ollama installation completed but command not found in PATH.')
    error('You may need to restart your terminal.')
    return false
  }

  log('Ollama installed successfully')
  return true
}

function startOllama() {
  log('Starting Ollama...')
  const child = spawn('ollama', ['serve'], {
    detached: true,
    stdio: 'ignore',
    shell: platform() === 'win32',
  })
  child.unref()

  return new Promise((resolve) => {
    let attempts = 0
    const maxAttempts = 30
    const interval = setInterval(() => {
      attempts++
      if (isOllamaRunning()) {
        clearInterval(interval)
        resolve(true)
      } else if (attempts >= maxAttempts) {
        clearInterval(interval)
        resolve(false)
      }
    }, 1000)
  })
}

async function pullModel(model) {
  log(`Pulling model: ${model}...`)
  return new Promise((resolve, reject) => {
    const child = spawn('ollama', ['pull', model], {
      stdio: 'inherit',
      shell: platform() === 'win32',
    })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ollama pull ${model} exited with code ${code}`))
    })
    child.on('error', (err) => reject(err))
  })
}

async function setupOllama() {
  console.log('')
  console.log('  ──────────────────────────────────────────────────────────')
  console.log('  Aura uses Ollama for AI-powered code analysis.')
  console.log('  For quick plug-and-play, we recommend installing Ollama')
  console.log('  and pulling the required models (glm-5.1:cloud, mxbai-embed-large).')
  console.log('  ──────────────────────────────────────────────────────────')
  console.log('')

  if (isOllamaInstalled()) {
    const version = run('ollama --version')?.trim()
    log(`Ollama is already installed${version ? ` (${version})` : ''}`)
  } else {
    const answer = await askQuestion('  Ollama is not installed. We strongly recommend installing it for Aura AI features (code analysis, embeddings). Install now? [Y/n] ')
    if (answer === 'n' || answer === 'no') {
      return
    }

    const installed = installOllama()
    if (!installed) return
  }

  // Start Ollama if not running
  if (isOllamaRunning()) {
    log('Ollama is already running')
  } else {
    const started = await startOllama()
    if (!started) {
      error('Could not start Ollama. Please start it manually and re-run: npm run setup')
      return
    }
    log('Ollama started')
  }

  // Pull required models
  console.log('')
  for (const model of REQUIRED_MODELS) {
    try {
      await pullModel(model)
      log(`Model ${model} ready`)
    } catch (e) {
      error(`Failed to pull model ${model}: ${e.message}`)
      if (model === 'glm-5.1:cloud') {
        warn('Cloud models require Ollama signin. Run: ollama signin')
      }
      warn('You can pull models later by running: npm run setup')
      return
    }
  }

  // Ollama signin for cloud models
  console.log('')
  log('Signing in to Ollama (required for cloud models like glm-5.1:cloud)...')
  console.log('')
  const signinResult = runInherit('ollama signin')
  if (signinResult) {
    log('Signed in to Ollama')
  } else {
    warn('Ollama signin was skipped or failed.')
    warn('You can sign in later by running: ollama signin')
    warn('Cloud models (like glm-5.1:cloud) require authentication.')
  }

  console.log('')
  log('✓ Aura AI setup complete')
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n  ╔══════════════════════════════════════╗')
  console.log('  ║     AURA Setup                       ║')
  console.log('  ╚══════════════════════════════════════╝\n')

  // Step 1: Crawl4AI
  await setupCrawl4AI()

  // Step 2: Aura grammars (always needed)
  copyGrammars()

  // Step 3: Ollama (optional, prompts user)
  await setupOllama()

  console.log('\n  ✅ AURA setup complete!')
  console.log('  Run `npm run dev` to start the development server.\n')
}

main().catch((e) => {
  error(`Setup failed: ${e.message}`)
  process.exit(1)
})