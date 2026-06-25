// eslint-disable-next-line @typescript-eslint/no-unused-vars
function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
      `Add it to .env.local`
    )
  }
  return value
}

function optionalEnv(key: string, fallback: string = ''): string {
  return process.env[key] ?? fallback
}

export const config = {
  ai: {
    groqApiKey: optionalEnv('GROQ_API_KEY'),
    mistralApiKey: optionalEnv('MISTRAL_API_KEY'),
    geminiApiKey: optionalEnv('GEMINI_API_KEY'),
    huggingfaceApiKey: optionalEnv('HUGGINGFACE_API_KEY'),
    deepseekApiKey: optionalEnv('DEEPSEEK_API_KEY'),
  },
  app: {
    nodeEnv: optionalEnv('NODE_ENV', 'development'),
    isDev: process.env.NODE_ENV === 'development',
    isProd: process.env.NODE_ENV === 'production',
  }
} as const

export function validateConfig(): void {
  const aiKeys = [
    config.ai.groqApiKey,
    config.ai.mistralApiKey,
    config.ai.geminiApiKey,
    config.ai.huggingfaceApiKey,
    config.ai.deepseekApiKey,
  ]
  const hasAtLeastOneKey = aiKeys.some(k => k.length > 0)
  if (!hasAtLeastOneKey) {
    throw new Error(
      'No AI provider API keys found. At least one of ' +
      'GROQ_API_KEY, MISTRAL_API_KEY, GEMINI_API_KEY, ' +
      'HUGGINGFACE_API_KEY, DEEPSEEK_API_KEY must be set in .env.local'
    )
  }
}
