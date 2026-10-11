import { baseCompile } from '@intlify/message-compiler'
import { describe, expect, it } from 'vitest'
import en from '../src/i18n/en.json'

// vue-i18n compiles every message at runtime; a stray "@" or "{" throws in the browser (e.g. "SyntaxError: 10").
describe('i18n messages', () => {
  it('all compile', () => {
    const bad: string[] = []
    const walk = (o: Record<string, unknown>, path: string) => {
      for (const [k, v] of Object.entries(o)) {
        const key = path ? `${path}.${k}` : k
        if (v && typeof v === 'object') walk(v as Record<string, unknown>, key)
        else baseCompile(String(v), { onError: (e) => bad.push(`${key}: code ${e.code}`) })
      }
    }
    walk(en, '')
    expect(bad).toEqual([])
  })
})
