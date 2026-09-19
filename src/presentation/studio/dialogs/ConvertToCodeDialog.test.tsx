// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { ConvertPreparation } from '@/presentation/hooks/useConvertToCode'
import { HOLD_DURATION_MS } from '@/presentation/shared/HoldToConfirmButton'
import { ConvertToCodeDialog } from './ConvertToCodeDialog'

const READY: ConvertPreparation = { status: 'ready', warnings: [] }

function renderDialog(
  overrides: {
    preparation?: ConvertPreparation
    onConfirm?: () => void
    converting?: boolean
    renderError?: string | null
  } = {},
) {
  return render(
    <TooltipProvider>
      <ConvertToCodeDialog
        open
        onOpenChange={() => {}}
        templateName="Product launch"
        preparation={overrides.preparation ?? READY}
        converting={overrides.converting ?? false}
        renderError={overrides.renderError ?? null}
        onConfirm={overrides.onConfirm ?? (() => {})}
      />
    </TooltipProvider>,
  )
}

/** Answers the reduced-motion query, which jsdom does not implement at all. */
function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? matches : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('ConvertToCodeDialog', () => {
  it('says what conversion costs before it offers either way through', () => {
    renderDialog()
    expect(
      screen.getByRole('heading', { name: 'Convert “Product launch” to a code template?' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/replace the visual layout and can’t be undone/)).toBeInTheDocument()
    expect(screen.getByText('The exported TSX becomes the source of truth.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep editing visually' })).toBeInTheDocument()
  })

  it('converts once the hold has lasted long enough, and only once', async () => {
    vi.useFakeTimers()
    const onConfirm = vi.fn()
    renderDialog({ onConfirm })

    const hold = screen.getByRole('button', { name: 'Hold to confirm' })
    await act(async () => {
      hold.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    // Not yet: a quick press must not convert anything.
    await act(async () => {
      vi.advanceTimersByTime(HOLD_DURATION_MS / 2)
    })
    expect(onConfirm).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(HOLD_DURATION_MS)
    })
    expect(onConfirm).toHaveBeenCalledTimes(1)

    // Still held: the interval was cleared, so no second conversion.
    await act(async () => {
      vi.advanceTimersByTime(HOLD_DURATION_MS * 2)
    })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('converts from the checkbox and the button, which is the keyboard route', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    renderDialog({ onConfirm })

    // Unticked, the button explains itself instead of doing nothing.
    await user.click(screen.getByRole('button', { name: /Convert template/ }))
    expect(onConfirm).not.toHaveBeenCalled()

    await user.click(screen.getByRole('checkbox', { name: 'I understand the visual layout is discarded.' }))
    await user.click(screen.getByRole('button', { name: /Convert template/ }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('shows a countdown instead of a moving bar under reduced motion', async () => {
    stubReducedMotion(true)
    vi.useFakeTimers()
    renderDialog()

    const hold = screen.getByRole('button', { name: 'Hold to confirm' })
    await act(async () => {
      hold.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.getByText(/^1\.0s$/)).toBeInTheDocument()
  })

  it('offers no way through when a block cannot be converted', () => {
    renderDialog({
      preparation: {
        status: 'blocked',
        reasons: [
          {
            node: 'bulletList',
            message: '"bulletList" has no React Email equivalent yet, so it cannot be converted.',
            path: 'doc > container[0] > bulletList[1]',
          },
        ],
      },
    })

    expect(screen.getByText('These blocks have no React Email equivalent yet')).toBeInTheDocument()
    expect(screen.getByText('bulletList')).toBeInTheDocument()
    expect(screen.getByText('doc > container[0] > bulletList[1]')).toBeInTheDocument()
    expect(screen.getByText('Remove these blocks, or ask for support for them.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hold to confirm' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Convert template/ })).not.toBeInTheDocument()
  })

  it('shows a lossy conversion as a note, and still offers to convert', () => {
    renderDialog({ preparation: { status: 'ready', warnings: ['An image has no alternative text.'] } })
    expect(screen.getByText('An image has no alternative text.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hold to confirm' })).toBeInTheDocument()
  })

  it('reports a failed smoke render and says the template is untouched', () => {
    renderDialog({ renderError: 'Rendering failed: x is not defined.' })
    expect(screen.getByText(/Rendering failed: x is not defined./)).toBeInTheDocument()
    expect(screen.getByText(/the visual template is exactly as it was/)).toBeInTheDocument()
  })
})
