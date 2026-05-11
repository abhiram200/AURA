# Settings Panel Restructure — Design Spec

## Problem
The current Settings panel is a flat scrollable list of 7 sections (Model, AI Behavior, Context, Memory, Skills, Preferences, Archived Chats). This causes scroll fatigue, no visual hierarchy, and dense content with no breathing room.

## Solution: Card Grid + Modals
Replace the flat list with a 2-column card grid home screen. Clicking a card opens a centered overlay modal with that category's full settings.

### Layout
- **Panel width**: 400px (widened from 320px)
- **Home screen**: 2-column grid of category cards + 1 full-width card (Archived Chats)
- **Modal style**: Overlay — centered modal with semi-transparent backdrop over the settings panel
- **Animation**: Modal slides in from bottom + fade, backdrop fades in (framer-motion spring)

### Category Mapping (Old → New)
| Current Section | New Location |
|---|---|
| Model | General modal |
| Preferences (theme, font, animation) | General modal |
| AI Behavior (system prompt, preferences) | AI Behavior modal |
| Context (window size, auto-extract) | AI Behavior modal |
| Memory | Memory modal |
| Skills | Skills modal |
| Archived Chats | Archived Chats modal |

## Card Grid Home

Each card shows: emoji icon, title, subtitle (summary or count). Cards use the existing card component style with hover border highlight.

| Card | Emoji | Subtitle |
|---|---|---|
| General | ⚙️ | "Model, theme, font size" |
| AI Behavior | 🤖 | "Detail, tone, format" |
| Memory | 🧠 | "{N} facts" (green if >0) |
| Skills | 🛠️ | "{N} active" (green if >0) |
| Archived Chats | 📦 | "{N} chat{N≠1?'s':''} archived" (full-width card) |

## Modals

### General Modal
- **Default Model**: dropdown select (existing ModelSelection)
- **Theme**: pill toggle buttons (Dark / Light) — replaces ThemeToggle component
- **Animation Intensity**: pill toggle buttons (Subtle / Normal / Intense)
- **Font Size**: slider with min/max labels (12–22px)

### AI Behavior Modal
- **Additional details used to decide how the model should behave**: textarea (existing SystemPromptEditor, relabeled)
- **8 Preference dropdowns**: Response Detail, Technical Level, Response Format, Domains (text input), Personality, Proactiveness, Language Style, Use of Examples
- **Context Window Size**: slider (2–30)
- **Auto-Extract Memory**: toggle switch
- **Reset to Defaults** button at bottom

### Memory Modal
- **Add input**: text input + green "Add" button (Enter submits)
- **Memory list**: each item shows active/inactive dot (●/○), fact text, ⋮ action menu
  - ⋮ menu options: Edit (inline), Toggle active/inactive, Delete
  - Inactive items: dimmed opacity, strikethrough text
- **Footer**: legend explaining ●/○ and ⋮

### Skills Modal
- **Header row**: "{N} active · {M} inactive" count + green "Add Skill" button
- **Skill list**: each item shows active/inactive dot, skill name, handler type label, status badge, ⋮ menu
  - ⋮ menu options: Toggle active/inactive, Delete (disabled for builtins)
  - Inactive items: dimmed with red "inactive" badge
- **Footer**: hint text
- **Add Skill sub-modal**: opens from within Skills modal
  - JSON example block, textarea for pasting definition
  - Handler type selector (Prompt / API pills)
  - API fields (URL, Method) show when API selected
  - Cancel / Add Skill buttons

### Archived Chats Modal
- **Chat list**: each item shows chat icon, title (truncated), model + relative date, inline Restore/Delete buttons
- **Click chat title**: loads conversation read-only (opens chat, closes settings)
- **Empty state**: "No archived chats."
- **Footer**: hint text

## ⋮ Action Menu
Shared pattern for Memory and Skills items. A small dropdown that appears on click:
- Options vary by context (see each modal above)
- Positioned below the ⋮ icon, aligned right
- Closes on outside click or option select
- Same z-index fix pattern used for conversation dropdowns (parent gets elevated z-index when open)

## Components to Modify/Create

### Modify
- **SettingsPanel.tsx**: Complete rewrite — card grid home + modal state management
- **global.css**: New `.settings-card__*`, `.settings-modal__*`, `.settings-modal-backdrop__*` classes; remove `.settings-section__*`; widen panel from 320px to 400px

### Create
- **SettingsCard.tsx**: Reusable card component (icon, title, subtitle, onClick)
- **SettingsModal.tsx**: Reusable modal wrapper (title, onClose, children) with framer-motion animation
- **ActionMenu.tsx**: Shared ⋮ dropdown menu component

### Remove
- **SettingsSection.tsx**: No longer needed (flat sections replaced by modals)

### Existing components — modified for modal context
- **ModelSelection**: Reused as-is inside General modal
- **SystemPromptEditor**: Reused inside AI Behavior modal, label changed to "Additional details used to decide how the model should behave"
- **AIPreferences**: Reused inside AI Behavior modal (8 preference dropdowns)
- **ContextSettings**: Absorbed into AI Behavior modal — context window slider + auto-extract toggle rendered directly, no separate section wrapper
- **UserPreferences**: Components repurposed — ThemeToggle restyled as pill buttons (Dark/Light), animation restyled as pill selector (Subtle/Normal/Intense), font size slider stays
- **MemoryManager**: Modified to use ⋮ action menu (Edit/Toggle/Delete) instead of inline toggle button and × delete button
- **SkillsManager**: Modified to use ⋮ action menu (Toggle/Delete) instead of inline toggle button and × delete button; Add Skill sub-modal kept as-is
- **ArchivedChats**: Reused inside Archived Chats modal, with inline Restore/Delete buttons per item

## Animation
- Panel slides in from right (existing, unchanged)
- Modal: `initial={{ opacity: 0, y: 20, scale: 0.97 }}` → `animate={{ opacity: 1, y: 0, scale: 1 }}` → spring transition
- Backdrop: fade in/out
- Cards: hover border-color transition to `#00ff88`