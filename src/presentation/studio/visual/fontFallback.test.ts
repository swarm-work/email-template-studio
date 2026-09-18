import { describe, expect, it } from 'vitest'
import { STUDIO_FONT_STACK } from '@/infrastructure/render/studioTheme'
import { familiesIn, fontFallbackFor, fontFallbackSentence, primaryFamily } from './fontFallback'

describe('familiesIn', () => {
  it('splits a stack into unquoted family names', () => {
    expect(familiesIn("'Geist Variable', -apple-system, Arial, sans-serif")).toEqual([
      'Geist Variable',
      '-apple-system',
      'Arial',
      'sans-serif',
    ])
    expect(familiesIn('')).toEqual([])
  })
})

describe('primaryFamily', () => {
  it('takes the first family and drops its quotes', () => {
    expect(primaryFamily("'Geist Variable', -apple-system, Arial, sans-serif")).toBe('Geist Variable')
    expect(primaryFamily('"Geist Mono Variable", monospace')).toBe('Geist Mono Variable')
    expect(primaryFamily('Arial')).toBe('Arial')
    expect(primaryFamily('')).toBe('')
  })
})

describe('fontFallbackFor', () => {
  it('recognises the stack the studio actually exports with', () => {
    // If the theme's stack ever changes to something unchecked, this fails -
    // which is the point: the note must not keep reassuring people.
    const fallback = fontFallbackFor(STUDIO_FONT_STACK)
    expect(fallback.kind).toBe('known')
    if (fallback.kind !== 'known') return
    expect(fallback.family).toBe('Geist Variable')
    // Named exactly as the export requests them, generic keyword dropped.
    expect(fallback.fallbacks).toEqual(['-apple-system', 'Segoe UI', 'Arial'])
  })

  it('warns when a fallback further down the stack is unchecked', () => {
    // The bug this guards: only the FIRST family used to be looked at, so
    // swapping the tail for anything at all left the green note in place.
    const fallback = fontFallbackFor("'Geist Variable', Papyrus, fantasy")
    expect(fallback).toEqual({ kind: 'unknown', family: 'Geist Variable', unchecked: ['Papyrus'] })
  })

  it('warns when a stack has no named fallback at all', () => {
    expect(fontFallbackFor("'Geist Variable', sans-serif")).toEqual({
      kind: 'unknown',
      family: 'Geist Variable',
      unchecked: [],
    })
  })

  it('is honest about a stack it has never checked', () => {
    expect(fontFallbackFor('Comic Sans MS, cursive')).toEqual({
      kind: 'unknown',
      family: 'Comic Sans MS',
      unchecked: [],
    })
  })
})

describe('fontFallbackSentence', () => {
  it('lists the fallbacks in prose for a known stack', () => {
    expect(fontFallbackSentence(fontFallbackFor(STUDIO_FONT_STACK))).toBe(
      'Geist Variable will fall back to -apple-system, Segoe UI and Arial on Outlook desktop without layout jitter.',
    )
  })

  it('names the face it cannot vouch for', () => {
    const sentence = fontFallbackSentence(fontFallbackFor("'Geist Variable', Papyrus, fantasy"))
    expect(sentence).toContain('Papyrus')
    expect(sentence).toContain('has not checked')
    expect(sentence).not.toContain('without layout jitter')
  })

  it('warns rather than reassures for a stack with nothing after it', () => {
    const sentence = fontFallbackSentence(fontFallbackFor('Papyrus'))
    expect(sentence).toContain('Papyrus')
    expect(sentence).toContain('no named fallback')
    expect(sentence).not.toContain('without layout jitter')
  })
})
