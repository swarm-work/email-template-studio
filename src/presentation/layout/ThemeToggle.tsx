/**
 * System / Light / Dark, in the global header's right-hand cluster.
 *
 * Presentation layer: no rules of its own. Three options rather than a two-way
 * switch, because "follow the operating system" is a real answer and a flipped
 * switch cannot say it. A Radix `ToggleGroup` gives the three buttons
 * `radiogroup` semantics for free, the way the device toggle does.
 *
 * It themes the APP. The email keeps its own light palette: `.studio-sheet`
 * and the preview document both pin `color-scheme: light` (docs/DECISIONS.md
 * ADR-29).
 */
import { Monitor, Moon, Sun } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTheme } from '@/presentation/hooks/useTheme'
import { parseThemePreference, THEME_LABELS, THEME_PREFERENCES } from './theme'

const ICONS = { system: Monitor, light: Sun, dark: Moon }

export function ThemeToggle() {
  const { preference, setPreference } = useTheme()

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={preference}
      // Radix reports '' when the pressed item is clicked again. There is no
      // "no theme", so that is simply ignored and the choice stays.
      onValueChange={(next) => {
        if (next !== '') setPreference(parseThemePreference(next))
      }}
      aria-label="Colour theme"
      className="shrink-0"
    >
      {THEME_PREFERENCES.map((option) => {
        const Icon = ICONS[option]
        return (
          <ToggleGroupItem key={option} value={option} aria-label={THEME_LABELS[option]}>
            <Icon aria-hidden="true" />
          </ToggleGroupItem>
        )
      })}
    </ToggleGroup>
  )
}
