export const JS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs'])
export const TS_EXTENSIONS = new Set(['.ts', '.tsx'])
export const PY_EXTENSIONS = new Set(['.py', '.pyw'])
export const CSS_EXTENSIONS = new Set(['.css'])
export const SCSS_EXTENSIONS = new Set(['.scss', '.sass'])
export const HTML_EXTENSIONS = new Set(['.html', '.htm'])
export const VUE_EXTENSIONS = new Set(['.vue'])
export const PHP_EXTENSIONS = new Set(['.php', '.phtml'])
export const JAVA_EXTENSIONS = new Set(['.java'])
export const C_EXTENSIONS = new Set(['.c', '.h'])
export const CPP_EXTENSIONS = new Set(['.cpp', '.cxx', '.cc', '.hpp', '.hxx', '.hh', '.c++', '.h++'])

export const PARSABLE_EXTENSIONS = new Set([
  ...JS_EXTENSIONS,
  ...TS_EXTENSIONS,
  ...PY_EXTENSIONS,
  ...CSS_EXTENSIONS,
  ...SCSS_EXTENSIONS,
  ...HTML_EXTENSIONS,
  ...VUE_EXTENSIONS,
  ...PHP_EXTENSIONS,
  ...JAVA_EXTENSIONS,
  ...C_EXTENSIONS,
  ...CPP_EXTENSIONS,
])