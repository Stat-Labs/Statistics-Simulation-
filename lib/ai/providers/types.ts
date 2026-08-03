export type AIProviderId = 'groq' | 'mistral' | 'openai' | 'anthropic'

export interface AICallParams {
  systemPrompt: string
  userPrompt: string
  apiKey: string
  model?: string
  temperature?: number
  maxTokens?: number
}

export interface AIProvider {
  id: AIProviderId
  label: string
  defaultModel: string
  call(params: AICallParams): Promise<string>
}

export interface AIResponse {
  content: string
  provider: AIProviderId
  fallbackUsed: boolean
}
