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
    // BYOK + default model providers
    openaiApiKey: optionalEnv('OPENAI_API_KEY'),
    anthropicApiKey: optionalEnv('ANTHROPIC_API_KEY'),
  },
  auth: {
    secret: optionalEnv('AUTH_SECRET'),
  },
  db: {
    url: optionalEnv('DATABASE_URL'),
    driver: optionalEnv('DB_DRIVER'),
  },
  storage: {
    provider: (optionalEnv('STORAGE_PROVIDER', 'cloudinary') as 'cloudinary' | 's3' | 'local'),
    cloudinaryCloudName: optionalEnv('CLOUDINARY_CLOUD_NAME'),
    cloudinaryApiKey: optionalEnv('CLOUDINARY_API_KEY'),
    cloudinaryApiSecret: optionalEnv('CLOUDINARY_API_SECRET'),
    // STORAGE_PROVIDER=local writes to this directory (dev only, no external keys).
    localDir: optionalEnv('STORAGE_LOCAL_DIR', './storage'),
  },
  encryption: {
    masterKey: optionalEnv('ENCRYPTION_MASTER_KEY'),
  },
  retention: {
    // Free tier: delete the raw dataset after knowledge extraction (default).
    // Set RETAIN_RAW_DATASETS=true to keep raw files permanently (paid tier).
    retainRawDatasets: optionalEnv('RETAIN_RAW_DATASETS') === 'true',
  },
  app: {
    nodeEnv: optionalEnv('NODE_ENV', 'development'),
    isDev: process.env.NODE_ENV === 'development',
    isProd: process.env.NODE_ENV === 'production',
    publicUrl: optionalEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000'),
  }
} as const

export function validateConfig(): void {
  const aiKeys = [
    config.ai.groqApiKey,
    config.ai.mistralApiKey,
    config.ai.geminiApiKey,
    config.ai.huggingfaceApiKey,
    config.ai.deepseekApiKey,
    config.ai.openaiApiKey,
    config.ai.anthropicApiKey,
  ]
  const hasAtLeastOneKey = aiKeys.some(k => k.length > 0)
  if (!hasAtLeastOneKey) {
    throw new Error(
      'No AI provider API keys found. At least one of ' +
      'GROQ_API_KEY, MISTRAL_API_KEY, GEMINI_API_KEY, ' +
      'HUGGINGFACE_API_KEY, DEEPSEEK_API_KEY, OPENAI_API_KEY, ' +
      'ANTHROPIC_API_KEY must be set in .env.local'
    )
  }
}
