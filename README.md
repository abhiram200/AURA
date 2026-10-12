# AURA

**A local AI coding workspace whose agent works from a live knowledge graph of your project instead of reading the raw code.**

A coding agent that knows nothing about a project has two bad options: have the whole codebase pasted into its context window, or explore with tools, listing folders and opening files round after round, spending tokens just to learn where things are. AURA gives the agent a map up front. Its understanding of a project comes from a code knowledge graph, so a structural question is one graph query rather than a dozen file reads.

The graph engine started life as [SYNAPSE](https://github.com/abhiram200/SYNAPSE), which I built first for exactly this purpose and then integrated here.

## What's in it

**The workspace.** A development environment in the browser: file explorer, CodeMirror editor, real terminals (xterm.js over node-pty), a git tree view, a 3D dependency graph, and settings for models, skills, memory and the system prompt. Models run locally through [Ollama](https://ollama.com).

**The knowledge graph.** Tree-sitter parses the project into files, functions, classes, methods and variables, with import, call and inheritance edges. A file watcher keeps it current. On top of it:

- impact analysis with propagation-based severity and trace paths
- hybrid BM25 and embedding search fused with Reciprocal Rank Fusion
- HTTP route and API-call mapping, response-shape checks and process tracing
- git diff change detection and cross-codebase rename with dry runs

Parsing covers 17 Tree-sitter grammars: JavaScript, TypeScript, TSX, Python, HTML, CSS, SCSS, PHP, Java, C, C++, C#, Go, Rust, Kotlin, Dart and Bash. The standalone SYNAPSE supports JavaScript, TypeScript and Python.

**The agent.**

- About 40 tools: graph queries, file reads and writes, managed shell sessions, browser automation through Playwright, web search and vision
- splits large questions across sub-agents and merges their findings
- compacts long conversations with an AI-written summary, falling back to a rule-based one if that call fails
- notices when it is repeating tool calls without progress and changes approach
- loads skills on demand: playbooks for exploring, debugging, refactoring, building and impact analysis

## Run it

Requires Node.js 20+, Python with pip (for the Crawl4AI web-search fallback) and Ollama.

```bash
git clone https://github.com/abhiram200/AURA.git
cd AURA
npm install        # also runs scripts/setup-crawl4ai.js: Tree-sitter grammars, Crawl4AI, Ollama
npm run dev        # client on Vite, API server on :3001
```

Production build: `npm run build`, then `npm start`.

Unit tests: `npm run test:unit`. End-to-end tests: `npm test` (Playwright).

## How it was built

I built AURA with Claude Code as an AI-assisted workflow, which is why many commits carry a co-author trailer. I reviewed and shaped the design documents and specs before implementation (some are in `docs/superpowers/`), and when the agent got stuck on a bug I worked through the logic myself and steered it to the right fix.

About 48,000 lines of TypeScript, written between May and July 2026.

## Credits

SYNAPSE's design was inspired by [GitNexus](https://github.com/abhigyanpatwari/GitNexus). AURA can also call the GitNexus CLI for its dependency view.

## Author

Abhiram RS · [portfolio](https://abhiram200.github.io/portfolio/) · [GitHub](https://github.com/abhiram200)
