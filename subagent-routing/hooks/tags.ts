import type { RouteTier } from '../types'
import { parseTier } from './tiers'

const TAG = /(^|\s)#(leve|medio|médio|pesado|max|maximo|máximo)(?=[\s.,;:!?]|$)/gi

export type TagResult = { text: string; tag: RouteTier | null; count: number }

/** Remove as tags de nível do texto; a última vale. Texto que ficaria vazio é mantido. */
export function extractTag(text: string): TagResult {
  let tag: RouteTier | null = null
  let count = 0
  const stripped = text.replace(TAG, (_match: string, lead: string, word: string) => {
    count += 1
    tag = parseTier(word)
    return lead
  })
  if (count === 0) return { text, tag: null, count: 0 }

  const cleaned = stripped.replace(/[ \t]{2,}/g, ' ').trim()
  return { text: cleaned === '' ? text : cleaned, tag, count }
}
