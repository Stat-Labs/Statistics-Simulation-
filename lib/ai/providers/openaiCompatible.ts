import type { AICallParams } from './types'

/**
 * Shared caller for OpenAI-compatible chat-completions endpoints
 * (OpenAI, Groq, Mistral all speak this dialect).
 */
export async function callOpenAICompatible(
  endpoint: string,
  apiKey: string,
  model: string,
  params: AICallParams,
): Promise<string> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model ?? model,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt },
      ],
      temperature: params.temperature ?? 0.3,
      max_tokens: params.maxTokens ?? 2048,
    }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`${endpoint} API error [${response.status}]: ${errText.slice(0, 300)}`)
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error(`${endpoint} returned an unexpected response shape`)
  }
  return content
}
