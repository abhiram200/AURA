import type { Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { tokyoNightStorm } from '@fsegurai/codemirror-theme-tokyo-night-storm'
import { catppuccinMocha } from '@fsegurai/codemirror-theme-catppuccin-mocha'
import { vsCodeDark } from '@fsegurai/codemirror-theme-vscode-dark'
import { githubDark } from '@fsegurai/codemirror-theme-github-dark'
import { nord } from '@fsegurai/codemirror-theme-nord'
import { synthwave84 } from '@fsegurai/codemirror-theme-synthwave-84'
import { materialDark } from '@fsegurai/codemirror-theme-material-dark'
import { monokai } from '@fsegurai/codemirror-theme-monokai'
import { gruvboxDark } from '@fsegurai/codemirror-theme-gruvbox-dark'
import { palenight } from '@fsegurai/codemirror-theme-palenight'
import { githubLight } from '@fsegurai/codemirror-theme-github-light'
import { vsCodeLight } from '@fsegurai/codemirror-theme-vscode-light'
import { solarizedLight } from '@fsegurai/codemirror-theme-solarized-light'

export interface EditorThemeInfo {
  key: string
  label: string
  bg: string
  sidebar: string
  extension: Extension
  isLight: boolean
}

export const EDITOR_THEMES: EditorThemeInfo[] = [
  { key: 'catppuccin-mocha', label: 'Catppuccin Mocha', bg: '#1e1e2e', sidebar: '#181825', extension: catppuccinMocha, isLight: false },
  { key: 'one-dark', label: 'One Dark', bg: '#282c34', sidebar: '#21252b', extension: oneDark, isLight: false },
  { key: 'tokyo-night-storm', label: 'Tokyo Night Storm', bg: '#24283b', sidebar: '#1f2335', extension: tokyoNightStorm, isLight: false },
  { key: 'vscode-dark', label: 'VS Code Dark', bg: '#1e1e1e', sidebar: '#252526', extension: vsCodeDark, isLight: false },
  { key: 'github-dark', label: 'GitHub Dark', bg: '#0d1117', sidebar: '#161b22', extension: githubDark, isLight: false },
  { key: 'nord', label: 'Nord', bg: '#2e3440', sidebar: '#2b2f3c', extension: nord, isLight: false },
  { key: 'synthwave-84', label: 'Synthwave 84', bg: '#1a1a2e', sidebar: '#16162a', extension: synthwave84, isLight: false },
  { key: 'material-dark', label: 'Material Dark', bg: '#282c34', sidebar: '#21252b', extension: materialDark, isLight: false },
  { key: 'monokai', label: 'Monokai', bg: '#272822', sidebar: '#201e20', extension: monokai, isLight: false },
  { key: 'gruvbox-dark', label: 'Gruvbox Dark', bg: '#282828', sidebar: '#1d2021', extension: gruvboxDark, isLight: false },
  { key: 'palenight', label: 'Palenight', bg: '#292d3e', sidebar: '#24273d', extension: palenight, isLight: false },
  { key: 'github-light', label: 'GitHub Light', bg: '#ffffff', sidebar: '#f6f8fa', extension: githubLight, isLight: true },
  { key: 'vscode-light', label: 'VS Code Light', bg: '#ffffff', sidebar: '#f3f3f3', extension: vsCodeLight, isLight: true },
  { key: 'solarized-light', label: 'Solarized Light', bg: '#fdf6e3', sidebar: '#eee8d5', extension: solarizedLight, isLight: true },
]

const themeMap = new Map(EDITOR_THEMES.map((t) => [t.key, t]))

export function getThemeExtension(key: string): Extension {
  return themeMap.get(key)?.extension ?? catppuccinMocha
}

export function getThemeInfo(key: string): EditorThemeInfo {
  return themeMap.get(key) ?? EDITOR_THEMES[0]
}