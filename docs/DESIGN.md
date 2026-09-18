# Design system (as implemented)

Original visual system informed by the reference screenshots. The references taught composition and restraint; no name, logo, colour token or trade dress was copied. The longer analysis lives in `docs/design-brief.md`.

## Principles

1. **Colour means state.** Green = valid/healthy, amber = warning/paused, red = blocking error, blue = in progress. Everything else is neutral.
2. **Hairlines, not shadows.** Panels are white cards with 1 px borders on a warm off-white ground. Shadows appear only on floating menus, dialogs and toasts.
3. **Near-black is the only strong surface.** The primary button and the code editors share it, so the editor reads as the main object.
4. **Tool beside artefact.** Dark editors on the left, the white mail sheet on the right on a faint dot grid.
5. **Uppercase noun labels over values** for metadata (Subject, From, To); monospace for file names, versions, addresses and ids.
6. **Be honest in status text.** Unimplemented checks say Planned / Not connected / Simulated, never Pass.
7. **Friction scales with irreversibility.** Toast for success, disabled-with-reason for preconditions, confirmation dialog for discarding edits.
8. **Motion communicates a change of state and nothing else**, and respects `prefers-reduced-motion`.

## Tokens (`src/index.css`)

| Token                                  | Light                   | Use                              |
| -------------------------------------- | ----------------------- | -------------------------------- |
| `--background`                         | `oklch(0.982 0.002 95)` | App ground (warm off-white)      |
| `--card`                               | `oklch(1 0 0)`          | Panels, preview sheet            |
| `--border`                             | `oklch(0.9 0.004 95)`   | Hairlines                        |
| `--foreground`                         | `oklch(0.2 0.012 265)`  | Titles, values                   |
| `--muted-foreground`                   | `oklch(0.5 0.012 265)`  | Labels, helper text              |
| `--primary`                            | `oklch(0.22 0.014 265)` | Primary button                   |
| `--success` / `-muted` / `-foreground` | green family            | Valid, up to date                |
| `--warning` …                          | amber family            | Modified, paused, large HTML     |
| `--danger` …                           | red family              | Errors                           |
| `--info` …                             | blue family             | Rendering, running               |
| `--editor`, `--editor-chrome`          | `#282c34`, `#21252b`    | Editor surfaces (match one-dark) |
| `--radius`                             | `0.5rem`                | Controls 8 px; badges 6 px       |

Dark values exist under `.dark` for a later toggle.

## Typography

- UI: Geist (variable), 14 px base, 13 px in dense panels, 11 px uppercase tracked labels (`.meta-label`).
- Headings: `h1` 20 px semibold tight; section `h2` 12–14 px medium (semantic, visually quiet).
- Code and technical metadata: Geist Mono, 13 px in editors, 11–12 px in chips.
- No display serif: it would fight the technical tone of an internal tool.

## Components and states

| Component             | States                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| Status badge          | success / warning / danger / info / neutral / planned (dashed)                                   |
| Animated badge (beUI) | same tones + `loading` (pulse); icon and label roll on change; static under reduced motion       |
| Buttons               | primary (near-black), outline, ghost; disabled at 50% with a tooltip or dialog giving the reason |
| Tabs                  | line variant; disabled "Rendered HTML" until HTML exists                                         |
| Device toggle         | segmented radio group, visible checked state, accessible names                                   |
| Editor chrome         | file name, type badge, Modified/Original, Reset, status footer, error banner with stage + line   |
| Payload panel         | Schema valid / Schema invalid / Invalid JSON, Modified, issue list with paths                    |
| Preview frame         | envelope rows, status badge, refresh, banners (paused / last good), loading, error, empty        |
| Diagnostics           | real checks vs collapsed "not connected" placeholders                                            |
| Template card         | selected ring, Modified, category/version/kind chips                                             |
| Dialogs               | Send test (explanatory, action disabled), Reset confirmations                                    |
| Toasts                | bottom-right, one sentence, past tense                                                           |

## Microcopy rules

Short, direct, sentence case. Say what happened and what to do next. Examples used:

- "Sending is disabled in this milestone. Test email delivery will be added once a provider is connected."
- "Preview paused. Fix the preview payload to continue rendering."
- "The latest change failed to render. Showing the last successful preview."
- "Rendering was stopped after 5s. Check the template for infinite loops or very large output."
- "Import "x" is not available in the studio. Templates may only import: react, react/jsx-runtime, @react-email/components."

## Motion rules

- Durations 150–300 ms; springs only inside the vendored badge.
- Every transition is a state change: badge status, device width, collapsible chevron, spinner while rendering.
- `prefers-reduced-motion` disables all of it (global CSS rule + `useReducedMotion()` in the badge).
- Nothing blocks input; the preview keeps its last good state while updating.
