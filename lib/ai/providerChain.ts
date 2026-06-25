import { config } from '@/lib/config'
import type { AIProvider, AIResponse } from '@/lib/types'

async function callGroq(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.ai.groqApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 2048,
    }),
  })

  if (!response.ok) {
    throw new Error(`Groq API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  return data.choices[0].message.content
}

async function callMistral(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.ai.mistralApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'mistral-7b-instruct',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 2048,
    }),
  })

  if (!response.ok) {
    throw new Error(`Mistral API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  return data.choices[0].message.content
}

async function callGemini(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.ai.geminiApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
      }),
    }
  )

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  return data.candidates[0].content.parts[0].text
}

async function callHuggingFace(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const url = 'https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3'
  const body = {
    inputs: `<s>[INST] ${systemPrompt}\n\n${userPrompt} [/INST]`,
    parameters: { temperature: 0.3, max_new_tokens: 2048, return_full_text: false },
  }

  const doFetch = async (): Promise<Response> => {
    return fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.ai.huggingfaceApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }

  let response = await doFetch()

  if (response.status === 503) {
    await new Promise(res => setTimeout(res, 10000))
    response = await doFetch()
  }

  if (!response.ok) {
    throw new Error(`HuggingFace API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  return data[0].generated_text
}

async function callDeepseek(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.ai.deepseekApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 2048,
    }),
  })

  if (!response.ok) {
    throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  return data.choices[0].message.content
}

export async function callAI(
  systemPrompt: string,
  userPrompt: string,
  validator?: (content: string) => boolean
): Promise<AIResponse> {
  const providerConfigs = [
    { name: 'groq' as AIProvider, key: config.ai.groqApiKey, fn: () => callGroq(systemPrompt, userPrompt) },
    { name: 'mistral' as AIProvider, key: config.ai.mistralApiKey, fn: () => callMistral(systemPrompt, userPrompt) },
    { name: 'gemini' as AIProvider, key: config.ai.geminiApiKey, fn: () => callGemini(systemPrompt, userPrompt) },
    { name: 'deepseek' as AIProvider, key: config.ai.deepseekApiKey, fn: () => callDeepseek(systemPrompt, userPrompt) },
    { name: 'huggingface' as AIProvider, key: config.ai.huggingfaceApiKey, fn: () => callHuggingFace(systemPrompt, userPrompt) },
  ]
  const providers = providerConfigs.filter(p => p.key.length > 0)

  for (const provider of providers) {
    try {
      const content = await provider.fn()
      if (validator && !validator(content)) {
        console.warn(`[StatLab AI] ${provider.name} returned invalid/unparseable response. Trying next...`)
        continue
      }
      return {
        content,
        provider: provider.name,
        fallbackUsed: provider.name !== 'groq',
      }
    } catch (error) {
      console.warn(
        `[StatLab AI] ${provider.name} failed: ${(error as Error).message}. Trying next...`
      )
    }
  }

  throw new Error('All AI providers failed. Check API keys and rate limits.')
}
