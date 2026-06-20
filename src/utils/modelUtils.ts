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

const VISION_PATTERNS = [
  /vision/i,
  /llava/i,
  /bakllava/i,
  /minicpm-v/i,
  /qwen.*vl/i,
  /qwen2-vl/i,
  /phi-3.*vision/i,
  /pixtral/i,
  /cogvlm/i,
  /internvl/i,
  /idefics/i,
  /xfm/i,
]

export function isEmbeddingModel(modelName: string): boolean {
  return EMBEDDING_PATTERNS.some(pattern => pattern.test(modelName))
}

export function isVisionModel(modelName: string): boolean {
  return VISION_PATTERNS.some(pattern => pattern.test(modelName))
}