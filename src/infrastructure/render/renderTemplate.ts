/**
 * The full preview pipeline: source text + props -> HTML string.
 *
 * This module is environment-neutral: it runs inside the render Web Worker in
 * the browser and directly under Node in unit tests. It never touches the DOM.
 */
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import * as emailComponents from '@react-email/components'
import { render } from '@react-email/components'
import type { PreviewPayload, RenderResult } from '@/domain'
import { compileTemplate } from './compileTemplate'
import { evaluateTemplate, type ModuleMap } from './evaluateTemplate'

/**
 * Makes an ES module namespace look like a CommonJS module so that both
 * `import * as React from 'react'` and `import React from 'react'` work after
 * sucrase rewrites them to `require()` calls.
 */
function asCommonJsModule(namespace: object): Record<string, unknown> {
  const withDefault: Record<string, unknown> = { ...namespace }
  if (!('default' in withDefault)) withDefault.default = namespace
  withDefault.__esModule = true
  return withDefault
}

/** The complete allow-list of modules a template can import. */
export const TEMPLATE_MODULES: ModuleMap = {
  react: asCommonJsModule(React),
  'react/jsx-runtime': asCommonJsModule(jsxRuntime),
  '@react-email/components': asCommonJsModule(emailComponents),
}

export async function renderTemplate(source: string, props: PreviewPayload): Promise<RenderResult> {
  const startedAt = performance.now()

  const compiled = compileTemplate(source)
  if (!compiled.ok) return { ok: false, error: compiled.error }

  const evaluated = evaluateTemplate(compiled.code, TEMPLATE_MODULES)
  if (!evaluated.ok) return { ok: false, error: evaluated.error }

  try {
    const Component = evaluated.component as unknown as React.ComponentType<PreviewPayload>
    const element = React.createElement(Component, props)
    // `pretty: false` keeps the worker bundle free of the optional formatter.
    const html = await render(element, { pretty: false })
    // The same element rendered again, this time as the plain-text alternative
    // part every real email carries. It is done here, in the same worker
    // message, so that one request produces one `RenderResult` holding both
    // parts: the preview, the size checks and the send then never disagree
    // about which HTML the text belongs to. Its cost (measured at roughly a
    // third of the HTML render) is inside `durationMs` on purpose — that
    // number is what one render of this template costs the studio.
    const text = await render(element, { plainText: true })
    return { ok: true, html, text, durationMs: Math.round(performance.now() - startedAt) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const detail = error instanceof Error ? error.stack : undefined
    return { ok: false, error: { kind: 'render', message: `Rendering failed: ${message}`, detail } }
  }
}
