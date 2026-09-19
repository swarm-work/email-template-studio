/**
 * The tab strip above a set of editors: which view is showing, plus the actions
 * that apply to it.
 *
 * Presentation layer. Hand-rolled rather than Radix `Tabs` on purpose: every
 * CodeMirror editor has to stay mounted (see EditorPanel), and Radix unmounts
 * the panels it is not showing.
 *
 * Generic over the tab id so one strip serves both sets in `editorTabs.ts` and
 * neither caller has to widen its own union to a bare string.
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { EDITOR_TABS, panelId, tabId, type EditorTab, type EditorTabId } from './editorTabs'

export interface EditorTabBarProps<Id extends string> {
  value: Id
  onChange: (tab: Id) => void
  /** Prefix for the tab/panel id pair, so several editors can coexist. */
  baseId: string
  /** Format / Copy / Reset, rendered at the right end of the strip. */
  actions: ReactNode
  /** The tabs to draw; defaults to a code template's four. */
  tabs?: readonly EditorTab<Id>[]
  /** Names the strip for screen readers; two strips on one page need two names. */
  label?: string
}

export function EditorTabBar<Id extends string = EditorTabId>({
  value,
  onChange,
  baseId,
  actions,
  tabs = EDITOR_TABS as readonly EditorTab<Id>[],
  label = 'Editor files',
}: EditorTabBarProps<Id>) {
  function onKeyDown(event: React.KeyboardEvent) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const index = tabs.findIndex((tab) => tab.id === value)
    const next = tabs[(index + step + tabs.length) % tabs.length]
    onChange(next.id)
    document.getElementById(tabId(baseId, next.id))?.focus()
  }

  return (
    <div className="flex min-w-0 items-center gap-2 border-b px-2">
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex min-w-0 [scrollbar-width:none] items-center gap-1 overflow-x-auto py-1"
      >
        {tabs.map((tab) => {
          const active = tab.id === value
          return (
            <button
              key={tab.id}
              id={tabId(baseId, tab.id)}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={panelId(baseId, tab.id)}
              aria-label={tab.label}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(tab.id)}
              className={cn(
                'flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs transition-colors',
                tab.mono && 'font-mono',
                active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              {tab.readOnly ? (
                <span
                  aria-hidden="true"
                  className="border-border text-muted-foreground rounded border px-1 font-sans text-[10px]"
                >
                  Read only
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>
    </div>
  )
}
