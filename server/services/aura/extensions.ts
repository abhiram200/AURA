export const JS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs'])
export const TS_EXTENSIONS = new Set(['.ts', '.tsx'])
export const PY_EXTENSIONS = new Set(['.py'])
export const CSS_EXTENSIONS = new Set(['.css'])
export const SCSS_EXTENSIONS = new Set(['.scss', '.sass'])
export const HTML_EXTENSIONS = new Set(['.html', '.htm'])
export const VUE_EXTENSIONS = new Set(['.vue'])

export const PARSABLE_EXTENSIONS = new Set([
  ...JS_EXTENSIONS,
  ...TS_EXTENSIONS,
  ...PY_EXTENSIONS,
  ...CSS_EXTENSIONS,
  ...SCSS_EXTENSIONS,
  ...HTML_EXTENSIONS,
  ...VUE_EXTENSIONS,
])