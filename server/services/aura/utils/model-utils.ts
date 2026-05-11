const EMBEDDING_PATTERNS = [
  /embed/i,
  /\/e5[-_]/i,
  /^e5[-_]/i,
  /bge[-_]/i,
  /nomic-embed/i,
  /all-MiniLM/i,
  /sentence/i,
  /text-embedding/i,
]

export function isEmbeddingModel(modelName: string): boolean {
  return EMBEDDING_PATTERNS.some(pattern => pattern.test(modelName))
}