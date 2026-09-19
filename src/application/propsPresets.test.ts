import { describe, expect, it } from 'vitest'
import { buildPropsPresets, type PropsPresetId } from './propsPresets'

const SAMPLE = JSON.stringify(
  {
    recipientName: 'Ada',
    verificationUrl: 'https://example.test/verify',
    supportEmail: 'help@example.test',
    expiresInHours: 24,
    optedIn: true,
    tags: ['welcome'],
    brand: { name: 'Meridian' },
  },
  null,
  2,
)

/** Nothing declared: every key is optional and no value is pinned. */
const NO_SCHEMA = '{}'

/** The shape of a real starter schema: some keys required, one pinned to an enum. */
const SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    recipientName: { type: 'string', minLength: 1 },
    verificationUrl: { type: 'string', format: 'uri' },
    supportEmail: { type: 'string', format: 'email', pattern: '^[^@]+@[^@]+$' },
    role: { type: 'string', enum: ['admin', 'member', 'viewer'] },
    brand: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  required: ['recipientName', 'verificationUrl', 'role', 'brand'],
})

function preset(text: string, schemaText: string, id: PropsPresetId) {
  const found = buildPropsPresets(text, schemaText).find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error(`no ${id} preset`)
  return JSON.parse(found.text) as Record<string, unknown>
}

describe('buildPropsPresets', () => {
  it('offers the three presets, with Default carrying the text verbatim', () => {
    const presets = buildPropsPresets(SAMPLE, NO_SCHEMA)

    expect(presets.map((entry) => entry.id)).toEqual(['default', 'long', 'sparse'])
    expect(presets[0]?.text).toBe(SAMPLE)
  })

  it('offers only Default when the sample is not a JSON object', () => {
    expect(buildPropsPresets('{ not json', NO_SCHEMA).map((entry) => entry.id)).toEqual(['default'])
    expect(buildPropsPresets('[1, 2]', NO_SCHEMA).map((entry) => entry.id)).toEqual(['default'])
  })

  it('drops a derived preset that came out identical to one already listed', () => {
    // The shipped visual starter's sample is `{}`: there is nothing to stretch
    // and nothing to empty, so a picker here would be three no-ops.
    expect(buildPropsPresets('{}\n', NO_SCHEMA).map((entry) => entry.id)).toEqual(['default'])
  })

  describe('Long values', () => {
    const long = preset(SAMPLE, NO_SCHEMA, 'long')

    it('stretches plain strings past the canvas width', () => {
      expect(String(long.recipientName).length).toBeGreaterThanOrEqual(72)
      expect(String(long.recipientName)).toContain('Ada')
    })

    it('keeps a URL a URL and an address an address', () => {
      expect(String(long.verificationUrl)).toMatch(/^https:\/\/example\.test\/verify\//)
      expect(String(long.supportEmail)).toMatch(/^[^@]+@example\.test$/)
      expect(String(long.supportEmail).length).toBeGreaterThanOrEqual(72)
    })

    it('leaves non-strings alone and reaches into nested values', () => {
      expect(long.expiresInHours).toBe(24)
      expect(long.optedIn).toBe(true)
      expect(String((long.brand as Record<string, unknown>).name).length).toBeGreaterThanOrEqual(72)
      expect(String((long.tags as string[])[0]).length).toBeGreaterThanOrEqual(72)
    })

    it('leaves a value the schema pins to a fixed set exactly as it was', () => {
      const constrained = preset(
        JSON.stringify({ role: 'member', teamName: 'Platform Core' }),
        SCHEMA,
        'long',
      )

      // "member member member…" is not one of admin | member | viewer, so
      // stretching it would hand the author an invalid payload.
      expect(constrained.role).toBe('member')
      expect(String(constrained.teamName).length).toBeGreaterThanOrEqual(72)
    })

    it('leaves a value with a pattern alone, and still stretches its neighbours', () => {
      const long2 = preset(SAMPLE, SCHEMA, 'long')

      expect(long2.supportEmail).toBe('help@example.test')
      expect(String(long2.recipientName).length).toBeGreaterThanOrEqual(72)
    })
  })

  describe('Missing optional fields', () => {
    const sparse = preset(SAMPLE, NO_SCHEMA, 'sparse')

    it('keeps every key', () => {
      expect(Object.keys(sparse)).toEqual(Object.keys(JSON.parse(SAMPLE) as object))
    })

    it('empties each value the way its own type empties when nothing is required', () => {
      expect(sparse.recipientName).toBe('')
      expect(sparse.expiresInHours).toBe(0)
      expect(sparse.optedIn).toBe(false)
      expect(sparse.tags).toEqual([])
      expect(sparse.brand).toEqual({ name: '' })
    })

    it('leaves the schema-required keys filled in', () => {
      const withSchema = preset(SAMPLE, SCHEMA, 'sparse')

      expect(withSchema.recipientName).toBe('Ada')
      expect(withSchema.verificationUrl).toBe('https://example.test/verify')
      expect(withSchema.brand).toEqual({ name: 'Meridian' })
      // Not required by the schema, so these are the fields that go missing.
      expect(withSchema.supportEmail).toBe('')
      expect(withSchema.expiresInHours).toBe(0)
      expect(withSchema.tags).toEqual([])
    })

    it('is not offered at all when the schema requires every key', () => {
      const everythingRequired = JSON.stringify({
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'string' } },
        required: ['a', 'b'],
      })
      const presets = buildPropsPresets(JSON.stringify({ a: 'x', b: 'y' }), everythingRequired)

      expect(presets.map((entry) => entry.id)).toEqual(['default', 'long'])
    })
  })
})
