import type { AIProvider, AICallParams } from './types'
import { callOpenAICompatible } from './openaiCompatible'

export const groqProvider: AIProvider = {
  id: 'groq',
  label: 'Groq',
  defaultModel: 'llama-3.1-8b-instant',
  call(params: AICallParams) {
    return callOpenAICompatible(
      'https://api.groq.com/openai/v1/chat/completions',
      params.apiKey,
      this.defaultModel,
      params,
    )
  },
}
