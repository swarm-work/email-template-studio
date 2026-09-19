// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RepositoryResult, TemplateVersionSummary } from '@/application/repositories/templateRepository'
import type { TemplateId } from '@/domain'
import { NO_VERSIONS_MESSAGE, VersionHistoryDialog } from './VersionHistoryDialog'

const TEMPLATE_ID = 'tpl_welcome-verification' as TemplateId

const VERSIONS: readonly TemplateVersionSummary[] = [
  {
    versionNumber: 2,
    kind: 'code',
    note: 'Shorter subject line',
    createdBy: 'ada@example.test',
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    versionNumber: 1,
    kind: 'visual',
    note: '',
    createdBy: 'seed',
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
]

function renderDialog(answer: () => Promise<RepositoryResult<readonly TemplateVersionSummary[]>>) {
  const onListVersions = vi.fn(answer)
  render(
    <VersionHistoryDialog
      open
      onOpenChange={() => {}}
      templateId={TEMPLATE_ID}
      onListVersions={onListVersions}
    />,
  )
  return onListVersions
}

describe('VersionHistoryDialog', () => {
  it('lists the versions with number, kind, author, time and note', async () => {
    renderDialog(async () => ({ ok: true, value: VERSIONS }))

    expect(await screen.findByText('v2')).toBeInTheDocument()
    expect(screen.getByText('Shorter subject line')).toBeInTheDocument()
    expect(screen.getByText('ada@example.test')).toBeInTheDocument()
    expect(screen.getByText('2 hours ago')).toBeInTheDocument()
    expect(screen.getByText('3 days ago')).toBeInTheDocument()
    expect(screen.getByText('Code')).toBeInTheDocument()
    expect(screen.getByText('Visual')).toBeInTheDocument()
  })

  it('says so when there is nothing to show', async () => {
    renderDialog(async () => ({ ok: true, value: [] }))

    expect(await screen.findByText(NO_VERSIONS_MESSAGE)).toBeInTheDocument()
  })

  it('explains a failure and retries on demand', async () => {
    let attempt = 0
    const onListVersions = renderDialog(async () => {
      attempt += 1
      return attempt === 1
        ? { ok: false, failure: { code: 'unreachable', message: 'The studio API could not be reached.' } }
        : { ok: true, value: VERSIONS }
    })

    expect(await screen.findByText('The studio API could not be reached.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('v2')).toBeInTheDocument()
    expect(onListVersions).toHaveBeenCalledTimes(2)
  })

  // Restoring is M4 work; a button that pretended to do it would be the exact
  // dishonesty this studio's design rules forbid.
  it('offers no way to restore a version', async () => {
    renderDialog(async () => ({ ok: true, value: VERSIONS }))
    await screen.findByText('v2')

    expect(screen.queryByRole('button', { name: /restore/i })).not.toBeInTheDocument()
  })
})
