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

| State          | What is shown                                                                                                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading        | Three `Skeleton` card outlines the same size as real cards, plus one for the heading, so nothing jumps when it lands                                                                                                                                                                        |
| Error          | Destructive `Alert`, one of three: "Your session has ended" (401, with **Sign in again**, which reloads so `PasswordGate` re-runs), "Template storage is unavailable" (503: no D1 binding, with **Retry**), or "Templates could not be loaded" with the failure's own message and **Retry** |
| Empty          | Dashed panel: "No templates yet" / "Create a template to start authoring email."                                                                                                                                                                                                            |
| No search hits | Dashed panel: `No templates match "invoice".` and a **Clear search** button                                                                                                                                                                                                                 |

Cards are plain buttons named `Open <name>`: opening a template is an action, not a selection that
stays switched on, so there is no `aria-pressed` on them any more. Each card carries a sibling "⋯"
button named `More actions for <name>` (a button inside a button is invalid HTML) whose menu holds
**Open** and **Delete template…**.

**New template** is a live primary button: it opens the create dialog (name, slug, kind, start from).
Its submit button is the disabled-with-reason pattern — "Enter a name for the template." while the
name is empty, and "That name has no letters or numbers in it. Type a slug to use instead." when
`slugify` had nothing to keep — never a bare `disabled` with a silent tooltip.

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
rule the studio's **Save template** and **Convert to code** buttons follow.

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

**Visual workspace** (`visual/VisualWorkspace`) — the canvas and its rail, and the only part of the
studio that is downloaded on demand (ADR-18). `React.lazy` + `Suspense` with `VisualEditorSkeleton` as
the fallback — the shape of the finished screen, so nothing jumps when the editor arrives — and an
error boundary that turns a chunk that never loaded into a `RenderError { kind: 'editor-load' }`,
shown by the SAME `RenderErrorBanner` as a compile or export failure. One vocabulary for "the preview
pipeline could not finish".

**Email canvas** (`visual/EmailCanvas`) — a non-scrolling wrapper (so `CanvasChip` can stay in its
corner) holding `.dot-grid absolute inset-0 overflow-auto overscroll-contain`, and inside that a
column `mx-auto w-full px-6 py-10` capped at 600 + 2 + 48 px: the email, the sheet's hairline border
and 24 px of dotted ground on each side. The sheet itself is the **editor's own container**, given
`studio-sheet relative rounded-xl border bg-white` through the package's `className` prop.

That split is load-bearing. The package appends its bubble menu **inside** the editor container, so if
the container were the scroller, `overflow: auto` would clip the menu. Here the menu is positioned
against the sheet and the 40 px of gutter above and below it is where the menu goes when the selection
is on the first or last line; `e2e/visual.spec.ts` selects text at both edges and asserts the menu's
box stays inside the scroller's.

The chip reads `600 px canvas · 100%` with the tooltip _"Shown at actual size. The studio never scales
the email."_ Every other visual email builder zooms the canvas to fit; this one does not, and the chip
is where that promise is made.

**Inspector rail** (`visual/StudioInspector`) — 360 px, `bg-card flex w-[360px] shrink-0 flex-col
border-l`, and below `xl` an off-canvas drawer: `max-xl:absolute max-xl:inset-y-0 max-xl:right-0
max-xl:w-[min(360px,88vw)] max-xl:translate-x-full max-xl:transition-transform
max-xl:data-[open=true]:translate-x-0 motion-reduce:transition-none`, with a sibling backdrop and an
`InspectorToggle` (`aria-pressed` + `aria-controls`) in the sub-header. CSS, not a dialog: one React
tree, no focus fight, and the rail keeps its scroll position. Opening moves focus into the rail,
**Escape** closes it and gives focus back to the toggle. There is no focus trap — it is a panel.

The rail is rendered through a **portal**. The package renders our children as siblings of the editor
container, which is inside the canvas scroller; the rail belongs beside the canvas. A portal moves the
DOM without leaving the React tree, so the Inspector still sees the editor's context.

Tabs `Style | Data`. Style is our `Hierarchy` header (`Inspector.Breadcrumb` plus Insert image,
Duplicate block and Delete block as icon buttons) and then the package's own
`Inspector.Document` / `.Node` / `.Text` sections, restyled but not forked. Delete and Duplicate act
on the **block the cursor is in**, not on the text selection: what people mean by "Delete block" in a
rail is the block the breadcrumb's last crumb names. Then `FontFallbackNote`, which is data-driven
from `fontFallbackFor()` — a success note for a stack the studio has checked, a warning for anything
else, so the reassurance cannot outlive the theme that earned it. The footer strip repeats
`⌘S Save · ⌘P Preview · / Blocks` from the one `SHORTCUTS` array and is `aria-hidden`: it is a
reminder, not a control.

**Data tab** (`visual/MergeFieldsPanel`, above the props payload card) — the merge fields the
template uses and the sample values that fill them in. Heading `Merge fields`, a count chip
`<n> in document`, then one row per key: the token as a mono chip (which is the row's `<label>`), the
state chips `Unused` (in the JSON, not in the document) or `Not in payload` (in the document, with no
value the substitution could print — `missingMergeFields`' rule, so an empty string counts as a
value and the chip, the button below and the diagnostics row never disagree), an `Insert {{key}}`
icon button, and a `Sample value` input bound to the payload through `setPayloadValue`, so a dotted
key like `user.first_name` writes a nested object. Below the rows,
`Fill in missing keys` (disabled-with-reason when nothing is missing) and `Add field`, whose name is
checked against the key pattern before it can be used. At the bottom, a collapsed
**Sample values (JSON)** section wrapping the same `<CodeEditor>` the code mode's
`preview-props.json` tab uses, on the same `draft.payloadText` — which is how a visual template
finally gets a typeable payload. While that JSON does not parse, every write path in the panel is
switched off — the value inputs go read-only and both buttons are disabled with a reason — because
writing one key means re-printing the whole payload, and half-typed JSON cannot be re-printed
without losing what is in it. The panel says so above the rows.

This is also the studio's only route to a merge field besides typing one: the package's slash menu
cannot be given an item without replacing the whole menu (see the hooks inventory below), so
insertion goes through this panel and the `{{key}}` input rule. Empty state:
_"No merge fields yet. Type {{firstName}} in the canvas or add one here."_ The panel itself lives in
the lazy editor chunk but imports nothing from `@react-email/editor`: inserting a chip is a callback
`VisualEditorSurface` hands in, which is why it can be tested under jsdom without an editor.

### Editor hooks inventory (phase-5 step 0)

Recorded by mounting the real `EmailEditor` and `Inspector.*` under jsdom and reading the DOM back, so
the CSS in `src/index.css` targets attributes that genuinely exist.

**`data-re-*` attributes the Inspector renders**: `data-re-inspector-breadcrumb`, `-breadcrumb-list`,
`-breadcrumb-item`, `-breadcrumb-button`, `-breadcrumb-separator`, `-breadcrumb-ellipsis`,
`-section`, `-section-header`, `-section-toggle`, `-section-body`, `-prop-row`, `-label`, `-text`,
`-field`, `-select`, `-number`, `-input`, `-unit`, `-color-control`, `-color-trigger`, `-color-hex`,
`-toggle-group`, `-toggle-item`, `-button`, `-icon-button`, `-tooltip`, `-tooltip-content`.
The bubble menus use `data-re-bubble-menu`, `-bubble-menu-group`, `-bubble-menu-item`,
`-bubble-menu-separator`, plus `data-re-node-selector*`, `data-re-link-selector*` and the
`data-re-{btn,link,img}-bm-*` families; the slash menu uses `data-re-slash-command`,
`-slash-command-scroll`, `-slash-command-item`, `-slash-command-category`, `-slash-command-empty`.
Content classes: `.tiptap`, `.ProseMirror`, `.node-container`, `.node-heading`, `.node-h1`,
`.node-paragraph`, `.node-columns`, `.node-column`, `.react-renderer`.

**Mock controls vs what the package's sections give us.**

| Mock control                   | Package section                                                    | Decision                                                                 |
| ------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Size, Line height, Text colour | `Inspector.Text` → Typography                                      | kept as-is                                                               |
| Text alignment                 | `Inspector.Text` → Typography (`Align`)                            | kept as-is                                                               |
| Background                     | `Inspector.Background` / `.Document`                               | kept as-is                                                               |
| Padding L/R (and T/B)          | `Inspector.Padding` (`Spacing`, uniform or per side)               | kept as-is                                                               |
| Width (container constraint)   | `Inspector.Size` / `.Document` → Container                         | kept as-is                                                               |
| Node delete / duplicate        | none                                                               | **ours**, in the Hierarchy header, via Tiptap commands                   |
| Font family                    | none (`fontFamily` is not even a supported per-node property)      | **dropped**; the theme owns the stack and `FontFallbackNote` explains it |
| Font weight, Letter spacing    | none, though `fontWeight`/`letterSpacing` are supported properties | **TECH_DEBT**: our own rows beside the library's sections                |
| Margin top / bottom            | none                                                               | **TECH_DEBT**, with font weight                                          |
| Group `Reset` link             | none                                                               | **dropped**                                                              |

**Bubble menu.** The package's default text menu is a node selector, a link selector, then
bold / italic / underline / strike / code / uppercase, then left / centre / right — eleven controls
against the mock's eight, with high overlap. **No trimming**: `bubbleMenu.hideWhenActive*` hides the
WHOLE menu for a node or mark (it is how the button, link and image menus take over), not individual
items, so it is the wrong instrument, and the package defaults (`['button','horizontalRule']` /
`['link']`) are already right.

**Slash menu.** 14 items in three categories and **no Image item**: `imageSlashCommand` is exported
from `/plugins` but is not in `defaultSlashCommands`, and `EmailEditor` renders its own
`SlashCommand` root internally. A second root throws
(`RangeError: Adding different instances of a keyed plugin (slash-command$)`), so adding Image would
mean replacing the package's whole menu. Dropped from the slash menu; the canvas placeholder does not
promise it, and images go in through the rail's **Insert image** button (the package's own
`uploadImage` command) or by pasting or dropping a file.

**`@source` check.** `Inspector.Padding` and friends ship bare Tailwind utilities in their JSX
(`flex flex-col gap-2`, `flex items-center gap-1`, `flex items-center gap-0.5` …), and Tailwind does
not scan `node_modules`, so `@source '../node_modules/@react-email/editor/dist';` in `src/index.css`
is what guarantees they are generated. Measured against the built CSS, though, the line is
INSURANCE rather than the reason the rail looks right today: every utility the package's rows use is
already generated from the app's own source, and the only two classes `@source` adds to
`dist/client/assets/index-*.css` are `.italic` and `.list-item`. `Inspector.Padding` lays out as a
flex column either way — but it would stop doing so the day the package reaches for a utility this
app happens not to use.

**CSS import.** `import '@react-email/editor/themes/default.css'` type-checks under
`tsconfig.app.json` because it sets `allowArbitraryExtensions`.

### What the mock says that we do not

`Compiler AST` → **Render report**, every row measured from the render on screen. `TS errors: 0` →
`Type checking: Planned`, because sucrase strips types without checking them and the tooltip says to
run `npm run typecheck` for real diagnostics. `Edge Compiler 18ms` → `Worker render 18 ms`.
`Render Ready` → `Last render OK`. `UTF-8 CRLF` → `UTF-8 · LF`. `Tailwind CSS` tab → `Plain text`.
Coloured tab dots, the tab close ×, the gear and the `ReadOnly: OFF` switch are gone; read-only is
shown as a chip only where it is true. Two primaries became one: the simulated **Publish Template** is
deleted.

From the Visual mock: the slash-hint row's trailing ⊕ button is gone (the placeholder carries the
hint), and the hint itself does not say **Image**, because the package's slash menu has none — see the
hooks inventory above. The inspector's **Font Family** and **Font Weight** selectors, the
**Spacing** (letter-spacing) field, the **Margin Top / Margin Bottom** fields and the
**SPACING & PADDING** group's `Reset` link are not drawn: the package's sections do not offer them and
the library's grouping is kept rather than forked. The hero photograph, the `Acme Cloud` branding and
the `38 POPs SYNCED` overlay are mock furniture; the shipped starter is Meridian's, with no image (a
picture needs an uploaded URL, so a seeded one would point at nothing).

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
- "Only visible in this studio. Never sent." (internal description and tags, both editable since phase 7b)
- "Values used by the preview and by test sends. They are never sent to real recipients." (props payload)
- "Put the cursor in template.tsx to insert a primitive." (primitives row on another tab)
- "Compiled with Sucrase — types are stripped, not checked." (compile strip)
- "Gmail hides everything past about 102 KB behind a 'View entire message' link." (status bar tooltip)
- "Coming with the converter." (convert to code)
- `Save template` → `Saving…` → the status bar's `Last saved v8 · 10:22`; "There are no changes to save." / "Wait for the preview to render before saving." / "Wait for the preview to finish rendering." (a render is in flight, so the export on hand belongs to the previous edit) / "Fix 2 errors to save: Preview payload (+1 more)." (why Save cannot be pressed, naming the first row to fix) · "A save is already in progress."
- "Save failed. The template was not changed." (a persistent toast with a Retry action; the draft is untouched)
- "This template was saved elsewhere as v8." (conflict dialog title) / "This template was changed elsewhere." (the same dialog when only metadata moved, so there is no new version to name) · `Save as a copy` · `Discard mine and load v8` · `Keep editing`
- "You have unsaved edits made against v5. This template is now v7." (the banner shown when a draft was started against an older version) · `Keep mine`
- "Your edits are still here and nothing was written. Keep them under a new name, throw them away and start from the saved version, or carry on and decide later." (the conflict dialog's body)
- "A template with that name already exists. Try another name." (create dialog, a slug that is taken — shown on the Name field, because the name is what you change) · "Use lower-case letters, numbers and single hyphens." (a hand-edited slug the API would refuse, shown on the Slug field before anything is sent)
- "Draft kept." (leaving the editor for the library with unsaved edits: the draft survives in this browser, so this is a note, not a question)
- "A template is created as a draft at version 1. You can rename it, describe it and tag it once it is open." (create dialog) · "Used in the API. It cannot be changed after the first publish." (slug) · `Visual — edit on a canvas` · `Code — edit React Email TSX` · `Blank` / `Copy of <name>` · "A copy keeps the kind of the template it came from."
- "This deletes the template and all 7 versions of it. It cannot be undone from the studio." (delete dialog) · "Type `welcome-verification` to confirm" · "This is a starter. Re-running the seed migration (`npm run db:migrate`) puts it back at version 1." · `Template deleted.`
- "Your session has ended" / "Sign in again to carry on. Your drafts are still in this browser." (the library after a 401; the button reloads, which is what re-runs the password gate)
- "Template storage is unavailable" / "No template database is bound to this server, so nothing can be listed or saved. Any draft you already have is kept in this browser." (the library after a 503)
- "This template is written in TSX. Visual editing is only available for visual templates." (mode toggle)
- "This template is edited visually. Switch to Visual to change it, or convert it to a code template." (the Code button on a visual template, and the banner over the read-only export views)
- "The visual editor is switched off. This template is read-only until it is switched back on." (the `STUDIO_VISUAL_EDITOR` rollback switch)
- "Shown at actual size. The studio never scales the email." (canvas chip) · `600 px canvas · 100%`
- "Type \"/\" for blocks — text, button, section, columns, divider" (the empty-block placeholder; it does not say image, see the hooks inventory)
- "Select a block on the canvas to edit it." (the inspector's Duplicate and Delete with nothing selected)
- "Geist Variable will fall back to -apple-system, Segoe UI and Arial on Outlook desktop without layout jitter." (client-safe typography, generated from the theme's own stack — the whole stack, so changing any entry to a face the studio has not checked turns the note into its warning variant)
- "Couldn't upload <name>." (a failed image upload; the temporary node is removed with it)
- "The visual editor could not be downloaded. Check your connection and reload the page." (the lazy chunk never arrived)
- "The visual editor is still loading." / "Nothing to undo yet." / "Nothing to redo." (undo and redo)
- "Nothing rendered yet." (both downloads, the thumbnail and the plain-text panel before the first render; one exported constant in `studio/preview/previewStatus.ts`)
- "This is the export saved with the current version. There is nothing to render again." (Refresh, while the flag-off preview is showing what the record holds)
- `Template source` · "Compiles. Matches the original file." (a code template's first diagnostic) vs `Canvas document` · "Exports. Contains unsaved local edits." (a visual one's) — the row names what the template actually has
- "Scaled to 41% of 680 px. ⌘P opens the full preview." (thumbnail caption) · "Open full preview"
- "Preview mode. Read only." / "Code editor." (the hidden live region that announces a mode change)
- "Plain text ready" / "Plain text —" (status bar) · "No preheader text." (envelope summary)
- `Merge fields` · `4 in document` · `Insert {{recipientName}}` · `Unused` · `Not in payload` · `Fill in missing keys` · `Add field` · `Sample values (JSON)` (the inspector's Data tab)
- "No merge fields yet. Type {{firstName}} in the canvas or add one here." (Data tab, empty)
- "Unknown variable {{x}} · not in payload" (diagnostics, warning) / "All merge fields have values" (pass) — and the row is absent entirely when the template uses no merge fields
- "Unsafe link after substitution" (diagnostics, error: a payload value turned an href into `javascript:` or `data:`)
- "Every merge field already has a value." (Fill in missing keys, with nothing to fill) · "A field name starts with a letter or underscore and may contain letters, digits, underscores and dots." (Add field, invalid name) · "Fix the sample values JSON below first." (every Data tab control, while the payload does not parse) · "The sample values are not valid JSON, so these fields are read-only." (the same, said once above the rows)
- "Uses {{firstName}}" (under the envelope's Subject line, when it contains a merge field)
- "Where replies go. Leave empty to reply to the From address." (the send dialog's Reply-to) · `Current preview, 14.2 KB HTML + 3.1 KB plain text` (its Body row)

## Motion rules

- Durations 150–300 ms. The badge's roll-in is CSS keyframes on the `EASE_OUT` curve; phase 6 removed `motion` entirely (ADR-4 update, TECH_DEBT #30), so nothing in the studio runs spring physics any more.
- Every transition is a state change: badge status, device width, collapsible chevron, spinner while rendering.
- `prefers-reduced-motion` disables all of it (global CSS rule, plus a `@media` block that switches the badge's `.badge-roll` and `.badge-pulse` animations off).
- Nothing blocks input; the preview keeps its last good state while updating.
