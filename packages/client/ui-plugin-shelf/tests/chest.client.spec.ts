import { afterEach, describe, expect, it, vi } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import { CHEST_EXPANDED_KEY, createChestExpandedStore } from '../src/client/preference.ts'

/** A localStorage stand-in that reports what the browser would have stored. */
function stubStorage(): Map<string, string> {
  const entries = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value) },
    removeItem: (key: string) => { entries.delete(key) },
    clear: () => { entries.clear() },
  })
  return entries
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('chest fold preference', () => {
  it('starts folded and writes the choice under the documented key', () => {
    const entries = stubStorage()
    const expanded = createChestExpandedStore()
    expect(expanded.getSnapshot()).toBe(false)
    expect(entries.get(CHEST_EXPANDED_KEY)).toBeUndefined()

    expanded.set(true)
    expect(entries.get(CHEST_EXPANDED_KEY)).toBe('true')

    expanded.set(false)
    expect(entries.get(CHEST_EXPANDED_KEY)).toBe('false')
  })

  it('rehydrates a previous choice, so a folded chest stays folded', () => {
    const entries = stubStorage()
    entries.set(CHEST_EXPANDED_KEY, 'true')
    expect(createChestExpandedStore().getSnapshot()).toBe(true)

    entries.set(CHEST_EXPANDED_KEY, 'false')
    expect(createChestExpandedStore().getSnapshot()).toBe(false)
  })
})

describe('chest copy', () => {
  it('carries no emoji in either dictionary', () => {
    const emoji = /\p{Extended_Pictographic}/u
    for (const [key, value] of Object.entries(zh)) expect([key, value, emoji.test(value)]).toEqual([key, value, false])
    for (const [key, value] of Object.entries(en)) expect([key, value, emoji.test(value)]).toEqual([key, value, false])
  })

  it('keeps the two dictionaries on the same key set', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('keeps the section title lowercase as designed', () => {
    expect(zh.section).toBe('chest')
    expect(en.section).toBe('chest')
  })
})
