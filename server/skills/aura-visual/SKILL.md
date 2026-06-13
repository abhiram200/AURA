---
name: aura-visual
description: How to use the visual companion for mockups, diagrams, and visual options during building and implementing
---

## Visual Companion

A browser-based visual companion for showing mockups, diagrams, and visual options during building. It appears as a "Visual" tab in the builder when active.

## When to Use

Decide per-question, not per-session. The test: **would the user understand this better by seeing it than reading it?**

### Use the visual companion for:
- **UI mockups** — wireframes, layouts, navigation structures, component designs
- **Architecture diagrams** — system components, data flow, relationship maps
- **Side-by-side visual comparisons** — comparing two layouts, two design directions
- **Design choices** — questions about look and feel, spacing, visual hierarchy
- **Flow diagrams** — state machines, process flows, entity relationships

### Use the terminal for:
- **Requirements and scope questions** — "what does X mean?", "which features are in scope?"
- **Conceptual A/B/C choices** — picking between approaches described in words
- **Tradeoff lists** — pros/cons, comparison tables
- **Technical decisions** — API design, data modeling, architectural approach selection

**Important:** A question *about* a UI topic is not automatically a visual question. "What kind of dashboard?" is conceptual (terminal). "Which dashboard layout works better?" is visual (companion).

## How to Use

### 1. Push a visual screen

Call `visual_preview` with:
- `filename`: a semantic name like "dashboard-layout" or "auth-flow". Never reuse filenames — append version suffixes like "-v2" for iterations.
- `content`: an HTML content fragment using the provided CSS classes (see below). NOT a full HTML document — the frame provides everything.
- `title`: a brief description like "Dashboard Layout Options"

### 2. Tell the user

After pushing a screen, tell the user:
- A visual preview is available in the Visual tab
- A brief text summary of what's on screen
- Ask them to look at it and respond in the chat

### 3. Read interactions

After the user responds, call `read_visual_events` to see their clicks/selections from the browser. Merge this with their chat message for the full picture.

### 4. Iterate or advance

If feedback changes the current screen, push a new version:
```
visual_preview(filename="dashboard-v2", content=..., title="Dashboard Layout Options v2")
```

Only move on when the current visual question is resolved.

### 5. Unload when returning to terminal

When the next step doesn't need the browser, push a waiting screen:
```
visual_preview(filename="waiting", content="<div class='waiting-container'><p class='subtitle'>Continuing in chat...</p></div>", title="Waiting")
```

## Available CSS Classes

### Options (A/B/C choices)

```html
<div class="options">
  <div class="option" data-choice="a" onclick="toggleSelect(this)">
    <div class="letter">A</div>
    <div class="content">
      <h3>Option Title</h3>
      <p>Option description</p>
    </div>
  </div>
</div>
```

For multi-select, add `data-multiselect` to the container:
```html
<div class="options" data-multiselect>
  <!-- users can select/deselect multiple -->
</div>
```

### Cards (visual designs)

```html
<div class="cards">
  <div class="card" data-choice="design1" onclick="toggleSelect(this)">
    <div class="card-image"><!-- mockup content --></div>
    <div class="card-body">
      <h3>Name</h3>
      <p>Description</p>
    </div>
  </div>
</div>
```

### Mockup container

```html
<div class="mockup">
  <div class="mockup-header">Preview: Dashboard Layout</div>
  <div class="mockup-body"><!-- your mockup HTML --></div>
</div>
```

### Split view (side-by-side)

```html
<div class="split">
  <div class="mockup"><!-- left --></div>
  <div class="mockup"><!-- right --></div>
</div>
```

### Pros/Cons

```html
<div class="pros-cons">
  <div class="pros"><h4>Pros</h4><ul><li>Benefit</li></ul></div>
  <div class="cons"><h4>Cons</h4><ul><li>Drawback</li></ul></div>
</div>
```

### Mock elements (wireframe building blocks)

```html
<div class="mock-nav">Logo | Home | About | Contact</div>
<div style="display: flex;">
  <div class="mock-sidebar">Navigation</div>
  <div class="mock-content">Main content area</div>
</div>
<button class="mock-button">Action Button</button>
<input class="mock-input" placeholder="Input field">
<div class="placeholder">Placeholder area</div>
```

### Typography and sections

- `h2` — page title
- `h3` — section heading
- `.subtitle` — secondary text below title
- `.section` — content block with bottom margin
- `.label` — small uppercase label text

### Tables

Standard HTML tables work with automatic styling:
```html
<table>
  <tr><th>Column A</th><th>Column B</th></tr>
  <tr><td>Value 1</td><td>Value 2</td></tr>
</table>
```

## Content Fragments vs Full Documents

If your HTML starts with `<!DOCTYPE` or `<html`, it's served as-is. Otherwise, the frame wraps it automatically with header, CSS theme, selection tracking, and interactive infrastructure. Write content fragments by default — no `<html>`, `<head>`, or `<body>` tags needed.

## Building Workflow Integration

During the explore → research → ask → plan → implement cycle:
- **After exploring, before planning** — if the task involves UI/visual changes, show mockups of what you're planning to build
- **During `ask_user`** — for visual preference questions, use `visual_preview` to show options instead of text-only descriptions
- **After planning, before implementing** — show visual mockups so the user confirms the visual direction before code is written
- **During implementation** — for components whose appearance matters, push a preview of the intended result for confirmation