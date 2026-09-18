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

| Component             | States                                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status badge          | success / warning / danger / info / neutral / planned (dashed)                                                                                                        |
| Animated badge (beUI) | same tones + `loading` (pulse); icon and label roll on change; static under reduced motion                                                                            |
| Buttons               | primary (near-black), outline, ghost; never bare `disabled` — unavailable controls use `ReasonedButton` (aria-disabled, focusable, sr-only reason, toast on click)    |
| Editor tab bar        | hand-rolled roving-tabindex strip; every panel stays mounted (`hidden` + `inert`); generated tabs carry a `Read only` chip and are never disabled                     |
| Device toggle         | segmented radio group, visible checked state, accessible names                                                                                                        |
| Editor chrome         | tab strip (`template.tsx · preview-props.json · Compiled HTML · Plain text`) + Format / Copy / Reset, `CodeStatusStrip` footer, `RenderErrorBanner` with stage + line |
| Props payload card    | JSON valid / Schema invalid / Invalid JSON, Modified, issue list with paths                                                                                           |
| Preview frame         | envelope rows, status badge, refresh, banners (paused / last good), loading, error, empty                                                                             |
| Diagnostics           | real checks vs collapsed "not connected" placeholders                                                                                                                 |
| Template card         | kind (Visual/Code), status, category, version chips, Modified badge, "Updated 3 days ago"                                                                             |
| Template library      | skeleton (3 card outlines) / error Alert + Retry / empty / no search results — see below                                                                              |
| Global header         | brand, workspace label, env badge, nav with `aria-current`, render pill, Docs, Feedback, avatar                                                                       |
| Dialogs               | Send test (explanatory, action disabled), Reset confirmations                                                                                                         |
| Toasts                | bottom-right, one sentence, past tense                                                                                                                                |

## The template library, state by state

The library is the screen the studio lands on, and it has four of them. They are separate states, not
an array that happens to be empty, so each gets its own words (`useTemplateLibrary`).

| State          | What is shown                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| Loading        | Three `Skeleton` card outlines the same size as real cards, plus one for the heading, so nothing jumps when it lands |
| Error          | Destructive `Alert`, "Templates could not be loaded", the failure's own message, and a **Retry** button              |
| Empty          | Dashed panel: "No templates yet" / "Create a template to start authoring email."                                     |
| No search hits | Dashed panel: `No templates match "invoice".` and a **Clear search** button                                          |

Cards are plain buttons named `Open <name>`: opening a template is an action, not a selection that
stays switched on, so there is no `aria-pressed` on them any more. **New template** is rendered
`aria-disabled` with the reason "Coming with saved templates." — disabled with a reason, never bare
`disabled` with a silent tooltip.

## Header

One `GlobalHeader` inside one `AppShell`, rendered once by `App.tsx` so it never remounts between
screens; the first Tab lands on a **Skip to editor** link. Contents left to right: brand, workspace as
a **static label** (there is one workspace — a dropdown that cannot switch anything is a lie), the
environment badge, the nav (`Overview & Logs` and `Domains` are `aria-disabled` and say so when
clicked; `API Keys & Webhooks` and `Template Studio` work, and the current one carries
`aria-current="page"`), the render pill, Docs, Feedback and an initials avatar.

The render pill reads `Local · render worker 24 ms`, and only says `LIVE` when the send server reports
itself connected — it is a measurement of this browser, which is what its tooltip says. It falls back to
`—` whenever no editor is open, because there is then no render on screen for it to be about.

Every `aria-disabled` control in the header points at one `sr-only` sentence, "Planned for a later
milestone.", so a screen reader is told what is unavailable **and** why — the same disabled-with-reason
rule the library's **New template** button follows.

Below `xl` the workspace label, the pill and Feedback step aside so the nav fits. The nav itself stays
down to `md` and becomes a horizontal scroll strip rather than disappearing: it is the only route
between the two screens, so hiding it would leave the app single-screen on a small laptop. Nothing in
the header is allowed to push the page into a horizontal scroll, and an e2e sweep at
1440/1280/1024/768 asserts it.

## The studio, band by band

The editor screen is five horizontal bands. Each one answers a different question, and none of them
competes with the editor for attention.

**Sub-header** (`chrome/StudioSubHeader`) — `sticky top-0 z-30 flex min-h-[52px] min-w-0 flex-wrap
items-center gap-2 border-b bg-card/85 px-4 backdrop-blur-sm`. Left: the breadcrumb
`Templates / <name>` (the crumb is a button, the name is the page's `h1`, truncated
`max-w-[14ch] sm:max-w-[28ch] lg:max-w-none`) and a rename pencil that is disabled with a reason.
Then the status badge — `<status> · Unsaved changes` / `<status> · Saved`, where the status word is
the template's own (`Draft`, `Ready`, `Deprecated`), so the badge cannot contradict the status bar —
and a quiet `aria-live` autosave note, hidden below `lg` with `max-lg:sr-only` rather than `hidden`,
because `display: none` would take the live region out of the accessibility tree. Right, inside
`role="toolbar" aria-label="Template actions"`: the mode group, undo/redo (visual templates only),
the device toggle, **Send test** as an outline button and **Save template** as the screen's single
primary. Below `md` the middle cluster steps aside and only Save and **⋯** remain — and the **⋯**
menu grows a `md:hidden` **Send test** item, so the one action that works never disappears.

**Envelope** (`envelope/EnvelopePanel`) — a `Collapsible` headed `Envelope & dispatch`, with
**Hide details** / **Show details** and **Reset envelope** on the right. The mock's `RFC-5322` chip is
a `?` tooltip instead: a chip that explains nothing is decoration. The grid is
`grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-6 xl:grid-cols-12` (spans 5/4/3 then 4/5/3) and fields are
`h-9 w-full min-w-0 rounded-md border-0 bg-muted px-2.5 text-sm shadow-none`. Subject, preheader and
reply-to are edited and go straight into the draft; From identity comes from the send server;
description and tags are metadata and are read-only until saving exists.

**Code workspace** (`code/CodeWorkspace`) — `CompileInfoStrip`, then the primitives row, then
`grid xl:grid-cols-[minmax(0,1fr)_300px]` with the editor left and the rail right; below `xl` the rail
stacks under the editor as `md:grid-cols-2`. The editor panel is one region, `Code editor`, holding
the tab strip (`template.tsx · preview-props.json · Compiled HTML · Plain text`, mono for the file
names, a `Read only` chip on the generated two), all four editors, the status strip and the render
banner. Format / Copy / Reset sit at the right end of the tab strip, not on the editor.

`CompileInfoStrip` also carries the sandbox's one hard rule — `Imports limited to react and
@react-email/components` — next to the sucrase note, so it is readable before the render error says it.

**Right rail** — Props payload, the **live preview thumbnail**, the render report with its
twelve-point sparkline, Diagnostics and the shortcuts card. The card's
Format and Reset are the same `ReasonedButton`s, with the same sentences, as the tab strip's: the two
copies of one action are on screen together, so they cannot be allowed to behave differently.

**Preview mode** (`preview/PreviewWorkspace`) — the third workspace, reached with the mode toggle or
⌘P. It is the same region name as before (`Preview`) and the same isolation: `iframe sandbox=""` plus
the CSP meta tag `buildPreviewDocument` injects, a `tabIndex={0}` frame with a real title and an
sr-only **Skip preview** link in front of it. Band by band: `PreviewToolbar` (the heading, an echo of
the device the sub-header chose, the render badge, `Rendered <time>`, **Refresh**, **Download HTML**,
**Download plain text**), `EnvelopeSummary` (Subject and Preheader from the draft, From from the send
server, To = the fixed sample recipient `Ada Lovelace <ada@example.com>`), tabs `Rendered | Plain
text` (both panels stay mounted, ADR-24), the dot-grid stage, and Diagnostics underneath — the same
panel the code rail carries, because the reasons a preview is wrong belong next to the preview.

Entering preview mode moves focus to the region (`tabIndex={-1}`, `focus({ preventScroll: true })`),
one hidden `role="status"` announces _"Preview mode. Read only."_ / _"Code editor."_, and **Escape**
inside the region goes back to the editor you came from — ⌘P is a round trip, not a destination.

**Preview thumbnail** (`code/PreviewThumbnail`) — the same document string, 40 % of the size. The
recipe is worth writing down: the email is rendered at its real 680 px and the whole iframe is scaled
with `transform: scale(w/680)` + `transform-origin: top left`, because an iframe lays its content out
against its own width — making it narrower would reflow the email instead of zooming out. A scaled
element still occupies its **unscaled** box in the flow, so the inner wrapper is `absolute` inside a
`h-[280px] overflow-hidden relative` box, and the box is what decides the card's height. The scale
comes from `useScaledFrame` (a `ResizeObserver`, clamped 0.2–1, three decimals). The frame itself is
decoration: `aria-hidden="true"`, `tabIndex={-1}`, `title=""`, `pointer-events-none`, with the
**Open full preview** button as the one accessible route in and the caption _"Scaled to 41% of 680 px.
⌘P opens the full preview."_ saying what you are looking at. It is not mounted in preview mode.

**Status bar** (`chrome/StudioStatusBar`) — `h-8`, `overflow-x-auto` with `shrink-0` segments and
`tabular-nums`: `Draft · v3`, the kind, `HTML export 14.2 KB`, the plain-text state, the Gmail budget,
and on the right one `aria-live` sentence `Last saved v3 · 10:22`. The numbers are not live regions;
a status bar that speaks every byte count is unusable.

Every strip that can run out of room (primitives, tab bar, status bar) scrolls inside itself with
`overflow-x-auto [scrollbar-width:none]`; the page itself never scrolls sideways, and the e2e sweep at
1440/1280/1024/768 asserts it for the sub-header, the envelope panel and the status bar too.

### What the mock says that we do not

`Compiler AST` → **Render report**, every row measured from the render on screen. `TS errors: 0` →
`Type checking: Planned`, because sucrase strips types without checking them and the tooltip says to
run `npm run typecheck` for real diagnostics. `Edge Compiler 18ms` → `Worker render 18 ms`.
`Render Ready` → `Last render OK`. `UTF-8 CRLF` → `UTF-8 · LF`. `Tailwind CSS` tab → `Plain text`.
Coloured tab dots, the tab close ×, the gear and the `ReadOnly: OFF` switch are gone; read-only is
shown as a chip only where it is true. Two primaries became one: the simulated **Publish Template** is
deleted.

## Microcopy rules

Short, direct, sentence case. Say what happened and what to do next. Examples used:

- "Sending is disabled in this milestone. Test email delivery will be added once a provider is connected."
- "Preview paused. Fix the preview payload to continue rendering."
- "The latest change failed to render. Showing the last successful preview."
- "Rendering was stopped after 5s. Check the template for infinite loops or very large output."
- "Import "x" is not available in the studio. Templates may only import: react, react/jsx-runtime, @react-email/components."
- "Most clients truncate subjects past 78 characters." (subject counter, past 78)
- "Shown after the subject in the inbox list. Leave empty to use the first line of the email." (preheader)
- "Set by the send server." (From identity) · "Enter a valid email address." (reply-to)
- "Editable once templates can be saved." (description and tags, until phase 7b)
- "Values used by the preview and by test sends. They are never sent to real recipients." (props payload)
- "Put the cursor in template.tsx to insert a primitive." (primitives row on another tab)
- "Compiled with Sucrase — types are stripped, not checked." (compile strip)
- "Gmail hides everything past about 102 KB behind a 'View entire message' link." (status bar tooltip)
- "Coming with saved templates." (Save, rename, mark as ready) · "Coming with the visual editor." (convert)
- "This template is written in TSX. Visual editing is only available for visual templates." (mode toggle)
- "Nothing rendered yet." (both downloads, the thumbnail and the plain-text panel before the first render; one exported constant in `studio/preview/previewStatus.ts`)
- "The visual canvas is not built yet. Preview mode shows what this template renders to." (a visual template's editor area, until phase 5)
- "Scaled to 41% of 680 px. ⌘P opens the full preview." (thumbnail caption) · "Open full preview"
- "Preview mode. Read only." / "Code editor." (the hidden live region that announces a mode change)
- "Plain text ready" / "Plain text —" (status bar) · "No preheader text." (envelope summary)

## Motion rules

- Durations 150–300 ms; springs only inside the vendored badge.
- Every transition is a state change: badge status, device width, collapsible chevron, spinner while rendering.
- `prefers-reduced-motion` disables all of it (global CSS rule + `useReducedMotion()` in the badge).
- Nothing blocks input; the preview keeps its last good state while updating.
