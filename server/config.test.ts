import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig, parseRecipientPolicy, parseRecipients } from './config.ts'

describe('loadConfig', () => {
  it('is disabled by default and never throws for a disabled setup', () => {
    const config = loadConfig({})
    expect(config.enabled).toBe(false)
    expect(config.port).toBe(8787)
  })

  it('fails fast when enabled but incomplete', () => {
    expect(() => loadConfig({ STUDIO_SEND_ENABLED: 'true' })).toThrow(ConfigError)
    expect(() =>
      loadConfig({ STUDIO_SEND_ENABLED: 'true', AWS_REGION: 'us-east-1', SES_FROM_ADDRESS: 'a@b.co' }),
    ).toThrow(/SES_ALLOWED_RECIPIENTS/)
  })

  it('parses a complete enabled setup', () => {
    const config = loadConfig({
      STUDIO_SEND_ENABLED: 'true',
      STUDIO_SEND_DRY_RUN: 'true',
      AWS_REGION: 'us-east-1',
      SES_FROM_ADDRESS: 'sender@example.com',
      SES_ALLOWED_RECIPIENTS: 'One@Example.com, two@example.com, one@example.com',
      STUDIO_SERVER_PORT: '9000',
      STUDIO_SEND_RATE_LIMIT_PER_MINUTE: '2',
    })
    expect(config).toEqual({
      enabled: true,
      port: 9000,
      dryRun: true,
      region: 'us-east-1',
      from: 'sender@example.com',
      recipientPolicy: 'allow-list',
      allowedRecipients: ['One@Example.com', 'two@example.com'],
      configurationSet: undefined,
      rateLimitPerMinute: 2,
    })
  })

  it('reads "*" as the any-recipient policy, with nothing to list', () => {
    const config = loadConfig({
      STUDIO_SEND_ENABLED: 'true',
      STUDIO_SEND_DRY_RUN: 'true',
      AWS_REGION: 'us-east-1',
      SES_FROM_ADDRESS: 'sender@example.com',
      SES_ALLOWED_RECIPIENTS: ' * ',
    })
    expect(config).toMatchObject({ recipientPolicy: 'any', allowedRecipients: [] })
  })

  it('rejects an invalid from address', () => {
    expect(() =>
      loadConfig({
        STUDIO_SEND_ENABLED: 'true',
        AWS_REGION: 'x',
        SES_FROM_ADDRESS: 'nope',
        SES_ALLOWED_RECIPIENTS: 'a@b.co',
      }),
    ).toThrow(/SES_FROM_ADDRESS/)
  })
})

describe('parseRecipients', () => {
  it('keeps spelling, dedupes case-insensitively and rejects junk loudly', () => {
    expect(parseRecipients(' A@x.io ,a@x.io,, b@y.io ')).toEqual(['A@x.io', 'b@y.io'])
    expect(parseRecipients(undefined)).toEqual([])
    expect(() => parseRecipients('a@x.io, junk')).toThrow(/invalid addresses: junk/)
  })
})

describe('parseRecipientPolicy', () => {
  it('accepts either the wildcard or a list, and refuses a mix of the two', () => {
    expect(parseRecipientPolicy('*')).toEqual({ policy: 'any', addresses: [] })
    expect(parseRecipientPolicy(' * ')).toEqual({ policy: 'any', addresses: [] })
    expect(parseRecipientPolicy('a@b.co')).toEqual({ policy: 'allow-list', addresses: ['a@b.co'] })
    // ConfigError specifically: worker/index.ts only treats that class as
    // "sending is off, the rest of the API still works"; any other Error
    // escapes as a bare crash.
    expect(() => parseRecipientPolicy('*, a@b.co')).toThrow(ConfigError)
    expect(() => parseRecipientPolicy('*, a@b.co')).toThrow(/either "\*" or a comma-separated list/)
    expect(() => parseRecipientPolicy('a@b.co,*')).toThrow(ConfigError)
    expect(() => parseRecipientPolicy('a@b.co,*')).toThrow(/either "\*" or a comma-separated list/)
  })
})

describe('loadConfig edge cases', () => {
  it('treats empty values as unset and only the literal "true" as enabled', () => {
    expect(loadConfig({ STUDIO_SEND_ENABLED: 'yes', SES_FROM_ADDRESS: '' }).enabled).toBe(false)
    expect(loadConfig({ STUDIO_SEND_ENABLED: 'false', SES_FROM_ADDRESS: '   ' }).enabled).toBe(false)
  })
})
