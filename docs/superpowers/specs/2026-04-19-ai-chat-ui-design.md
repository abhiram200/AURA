# AI Chat Interface — Design Spec

## Overview

A visually stunning AI chat interface with a dark futuristic aesthetic, featuring a 3D particle morphing intro, rich card AI responses, ambient background effects, and comprehensive micro-animations. Built with React + Vite + TypeScript, Three.js for 3D particles, and GSAP for animation orchestration. No backend — all state is local mock data.

## Visual Style

**Dark futuristic** — neon accents, glowing effects, cyberpunk-inspired aesthetic with particle animations and gradient glows.

## Tech Stack

- **Framework:** React 18 + Vite + TypeScript
- **3D Rendering:** Three.js via `@react-three/fiber` + `@react-three/drei`
- **Animation:** GSAP for timeline orchestration, Framer Motion for UI component animations
- **Content:** `react-markdown` + `highlight.js` for rich AI response rendering
- **Testing:** Playwright for UI testing (no backend tests)
- **Styling:** CSS custom properties + CSS modules

## Project Structure

```
ai-chat-ui/
├── public/
├── src/
│   ├── components/
│   │   ├── intro/
│   │   │   ├── ParticleOrb.tsx          # Three.js 3D particle sphere
│   │   │   └── IntroSequence.tsx        # GSAP timeline orchestrator
│   │   ├── chat/
│   │   │   ├── ChatLayout.tsx           # Main chat area shell
│   │   │   ├── MessageList.tsx          # Scrollable message container
│   │   │   ├── UserMessage.tsx          # User input display (minimal)
│   │   │   ├── AIMessage.tsx            # Rich card AI responses
│   │   │   ├── TypingIndicator.tsx      # Pulsing dots + particle trails
│   │   │   └── StreamingText.tsx         # Word-by-word reveal effect
│   │   ├── sidebar/
│   │   │   ├── Sidebar.tsx              # Conversation list panel
│   │   │   └── ConversationItem.tsx     # Single conversation entry
│   │   ├── settings/
│   │   │   ├── SettingsPanel.tsx         # Slide-out settings drawer
│   │   │   ├── SystemPromptEditor.tsx   # Custom system prompt textarea
│   │   │   ├── UserPreferences.tsx      # Theme, font size, animation speed
│   │   │   └── SettingsSection.tsx      # Reusable settings group wrapper
│   │   ├── input/
│   │   │   └── ChatInput.tsx            # Text input with glow effects
│   │   └── shared/
│   │       ├── GlowButton.tsx           # Neon-glow interactive button
│   │       ├── ThemeToggle.tsx          # Animated theme switcher
│   │       └── ParticleBackground.tsx   # Ambient floating particles
│   ├── hooks/
│   │   ├── useTheme.ts                  # Dark/light theme state
│   │   └── useChat.ts                   # Mock chat state manager
│   ├── styles/
│   │   ├── theme.css                    # CSS variables for both themes
│   │   ├── animations.css              # Global animation keyframes
│   │   └── global.css                   # Base styles, resets
│   ├── App.tsx
│   └── main.tsx
├── tests/
│   └── ui/                              # Playwright UI tests
├── package.json
└── vite.config.ts
```

## Intro Sequence

A 3-4 second splash animation on app load:

1. **Dark void** — screen is empty, subtle ambient particles drift
2. **Orb formation** (~2s) — thousands of 3D particles converge from scattered positions into a glowing sphere using Three.js InstancedMesh. GSAP timeline drives position, color, and scale interpolation
3. **Energy pulse** (~0.5s) — the orb emits a radial shockwave (shader-based ring expanding outward), particles briefly accelerate and glow brighter
4. **Morph to UI** (~1s) — particles split into streams that flow toward the screen edges, forming the outline of the chat interface. As they settle, UI elements fade in via Framer Motion stagger — sidebar, messages, input bar
5. **Background persists** — the particle system transitions to ambient background state (fewer, slower, dimmer particles floating behind the UI)

**Technical approach:**
- `@react-three/fiber` Canvas as full-screen overlay during intro, then repositioned as fixed background layer
- InstancedMesh for performance (thousands of particles in one draw call)
- Custom GLSL shaders for glow/bloom effects
- GSAP timeline sequences the intro, then hands off to Framer Motion for UI reveals

## Chat Interface

### Layout
- **Left:** Collapsible conversation sidebar (240px wide, animated slide via GSAP)
- **Center:** Chat message area (scrollable, auto-scroll on new messages)
- **Bottom:** Input bar with glow-on-focus effect
- **Right:** Settings drawer (slides in when opened)

### Messages
- **User messages** — right-aligned, minimal style (no card), slide-in from right
- **AI messages** — left-aligned rich cards with:
  - Markdown rendered via `react-markdown`
  - Code blocks with `highlight.js` syntax highlighting + copy button
  - Framer Motion `layoutAnimation` for smooth insertion
  - Subtle neon border glow on appear, then settles

### Streaming text effect
- AI responses stream word-by-word (mock delay between words)
- Each word fades in with slight upward motion
- Blinking cursor follows the last word
- Card does subtle "settle" animation when streaming completes

### Typing indicator
- Three pulsing dots with neon glow
- Small particle trail effect around the dots
- Fades in/out when AI is "thinking"

## Settings Panel

A slide-out drawer from the right side (animated via GSAP):

- **System Prompt Editor** — editable textarea for custom AI system instructions, saved per-conversation or globally
- **User Preferences** — theme selection, animation intensity (subtle/normal/intense), font size
- **SettingsSection** — reusable wrapper component for adding new settings groups

## Interactive Micro-Animations

- **Input bar:** neon border glow intensifies on focus, subtle pulse on submit
- **Buttons:** ripple effect on click, hover glow
- **Sidebar items:** slide highlight bar on hover, glow on active conversation
- **Theme toggle:** smooth crossfade between dark and light (CSS variables transition)
- **Message animations:** slide/fade in with glow, typing indicator with pulsing dots and particle trails
- **Ambient background:** subtle floating particles, gradient shifts, ambient light effects
- **Transitions:** sidebar/conversation list slides, modals scale-fade, theme morphs smoothly

## Theme System

### Dark Theme (Default)
| Token | Value |
|-------|-------|
| Background | `#0a0a1a` → `#0d0d2b` gradient |
| Primary accent | `#00f0ff` (electric cyan) |
| Secondary accent | `#8b5cf6` (neon purple) |
| AI card bg | `#12122a` with cyan border glow |
| Text primary | `#e2e8f0` |
| Text secondary | `#94a3b8` |
| Input bg | `#1a1a3e`, glow border on focus |

### Light Theme
| Token | Value |
|-------|-------|
| Background | `#f8fafc` → `#eef2ff` gradient |
| Primary accent | `#0891b2` (deep cyan) |
| Secondary accent | `#7c3aed` (rich purple) |
| AI card bg | `#ffffff` with subtle shadow |
| Text primary | `#1e293b` |
| Text secondary | `#64748b` |

### Implementation
- All colors as CSS custom properties on `:root`, swapped by `.light` / `.dark` class
- Framer Motion reads React context for JS-driven animation values
- Theme toggle triggers GSAP-animated crossfade (600ms) — background morphs, particles shift color, UI elements transition via CSS variable interpolation

## Testing Strategy (Playwright)

No backend tests. All tests use mock data from `useChat` hook:

1. **Intro sequence** — particle canvas renders, intro completes, chat UI appears
2. **Message flow** — type message → user message appears → AI mock response appears as rich card with streaming
3. **Markdown rendering** — code blocks render with syntax highlighting, copy button works
4. **Sidebar** — conversations list renders, clicking switches conversations, new conversation button works
5. **Settings** — drawer opens/closes, system prompt editor saves, theme toggle switches colors
6. **Theme toggle** — CSS variables change between dark and light values
7. **Responsive** — layout adapts on different viewport sizes (sidebar collapses on mobile)

## Mock Data

`useChat` hook returns pre-defined conversations with realistic markdown content. No API calls. All state is local React state. Conversations include code snippets, lists, and varied markdown to showcase rich card rendering.