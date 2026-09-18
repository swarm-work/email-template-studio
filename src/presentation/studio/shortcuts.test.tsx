// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ShortcutsCard } from './code/ShortcutsCard'
import { ShortcutsDialog } from './dialogs/ShortcutsDialog'
import { SHORTCUTS, shortcutKeys } from './shortcuts'

describe('SHORTCUTS', () => {
  it('has one entry per id, with keys for both platforms', () => {
    const ids = SHORTCUTS.map((shortcut) => shortcut.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.mac.length).toBeGreaterThan(0)
      expect(shortcut.other.length).toBeGreaterThan(0)
    }
    expect(shortcutKeys(SHORTCUTS[0], true)).toEqual(['⌘', 'S'])
    expect(shortcutKeys(SHORTCUTS[0], false)).toEqual(['Ctrl', 'S'])
  })

  it('drives the right-rail card', () => {
    render(<ShortcutsCard />)
    const region = screen.getByRole('region', { name: 'Keyboard shortcuts' })
    for (const shortcut of SHORTCUTS) {
      // getAllBy: one shortcut is itself called "Keyboard shortcuts", which the
      // card's own heading also says.
      expect(within(region).getAllByText(shortcut.label).length).toBeGreaterThan(0)
    }
  })

  it('drives the dialog from the same list', () => {
    render(<ShortcutsDialog open onOpenChange={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
    for (const shortcut of SHORTCUTS) {
      expect(within(dialog).getAllByText(shortcut.label).length).toBeGreaterThan(0)
    }
  })
})
