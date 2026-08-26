import type { AIProvider, AICallParams } from './types'

export const anthropicProvider: AIProvider = {
  id: 'anthropic',
  label: 'Anthropic (Claude)',
  defaultModel: 'claude-3-5-haiku-latest',
  async call(params: AICallParams): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': params.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model ?? this.defaultModel,
        max_tokens: params.maxTokens ?? 2048,
        temperature: params.temperature ?? 0.3,
        system: params.systemPrompt,
        messages: [{ role: 'user', content: params.userPrompt }],
      }),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`Anthropic API error [${response.status}]: ${errText.slice(0, 300)}`)
    }

    const data = await response.json()
    const content = data?.content?.[0]?.text
    if (typeof content !== 'string') {
      throw new Error('Anthropic API returned an unexpected response shape')
    }
    return content
  },
}
