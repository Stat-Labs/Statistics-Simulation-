import type { AIProvider, AICallParams } from './types'
import { callOpenAICompatible } from './openaiCompatible'

export const openaiProvider: AIProvider = {
  id: 'openai',
  label: 'OpenAI',
  defaultModel: 'gpt-4o-mini',
  call(params: AICallParams) {
    return callOpenAICompatible(
      'https://api.openai.com/v1/chat/completions',
      params.apiKey,
      this.defaultModel,
      params,
    )
  },
}
