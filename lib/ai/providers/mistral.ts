import type { AIProvider, AICallParams } from './types'
import { callOpenAICompatible } from './openaiCompatible'

export const mistralProvider: AIProvider = {
  id: 'mistral',
  label: 'Mistral',
  defaultModel: 'open-mistral-7b',
  call(params: AICallParams) {
    return callOpenAICompatible(
      'https://api.mistral.ai/v1/chat/completions',
      params.apiKey,
      this.defaultModel,
      params,
    )
  },
}
