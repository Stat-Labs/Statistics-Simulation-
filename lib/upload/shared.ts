export const CHUNK_SIZE = 2 * 1024 * 1024 // 2 MB default
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

export function safeParseChunks(raw: string): number[] {
  try {
    return JSON.parse(raw) as number[]
  } catch {
    return []
  }
}
