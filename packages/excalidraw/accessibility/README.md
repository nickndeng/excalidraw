# Accessibility Mirror

A hidden, keyboard-navigable DOM mirror of the Excalidraw scene, enabled
by default in the published `@excalidraw/excalidraw` component. The
mirror exposes every non-deleted scene element to assistive technology
(NVDA, JAWS, VoiceOver) and to keyboard-only users.

The mirror is enabled by default. To opt out:

```tsx
<Excalidraw accessibilityMirror={false} />
```

## Why

The drawing surface is rendered to `<canvas>`, which is opaque to AT:
screen readers see only an empty region, keyboard users cannot focus
shapes, and existing shortcuts assume a sighted user driving a pointer.
The mirror is a parallel-DOM solution that solves all three problems
without changing the canvas rendering path, scene file format, or
existing keyboard handlers.

See excalidraw/excalidraw#7492 and the Deque audit for the background.

## Architecture

```
packages/excalidraw/accessibility/
├── roleMapping.ts          Element → ARIA role / name / state
├── position.ts             Relative-position descriptor (RTL-aware)
├── spatialNav.ts           60° directional-cone neighbour search
├── virtualization.ts       Mount-set selection + diff
├── announcer.ts            Live-region message builder (i18n)
├── AccessibilityMirror.tsx React component (the tree + live region)
├── AccessibilityMirror.scss Visually-hidden styles
└── __tests__/              Unit / integration / RTL / perf tests
```

### ARIA model

The mirror root is a `role="tree"` with `aria-multiselectable="true"`.
Each scene element renders as `role="treeitem"` carrying:

- `aria-label` — composed from element type + visible text + a localized
  position descriptor (`"Rectangle, top-left of canvas"`,
  `"Text \"Note\", inside frame \"Inputs\""`).
- `aria-selected` — `true` for elements in `appState.selectedElementIds`.
- `aria-disabled` — `true` for locked elements.
- `aria-level`, `aria-posinset`, `aria-setsize` — tree hierarchy.
- `data-editing` — set while text-edit is active on the element.

Frames render a treeitem **and** a nested `role="group"` whose contents
are the frame's child treeitems. This matches WAI-ARIA 1.2 §6.7 (the
tree pattern) and is the cleanest ARIA structure for "z-ordered,
selectable, hierarchical".

The single source of truth for this mapping lives in
[`roleMapping.ts`](./roleMapping.ts) — every renderer code path passes
through `getMirrorDescriptor`.

### Keyboard model

| Key            | Action                                                                  |
| -------------- | ----------------------------------------------------------------------- |
| `Tab` / `Shift+Tab` | Cycle through elements in z-order (frame children before next sibling). |
| `↑ ↓ ← →`      | Spatial nav: nearest centroid within a 60° directional cone.            |
| `Enter`        | Toggle selection. `Shift+Enter` adds to the existing selection.         |
| `F2`           | Begin text edit on a text element or text container.                    |
| `Delete` / `Backspace` | Delete the selected element(s) via the existing action.         |
| `Esc`          | Clear selection and return focus to the canvas container.               |

All these handlers route the resulting state mutation through the
existing app actions (`actionDeleteSelected`, `app.setMirrorAppState`,
`app.beginTextEditForElement`). The mirror never holds parallel
selection state — `appState.selectedElementIds` is the source of truth.

`stopPropagation()` is called on every consumed key so the canvas-level
`onKeyDown` does not double-handle a press that has already produced its
intended effect in the mirror (e.g. `Enter` selecting a treeitem must
not also trigger the canvas-level "begin text edit on selected
rectangle" flow).

### Virtualization

On scenes with thousands of elements, mounting a DOM node per element
would tank both performance and accessibility (a screen reader user
should not have to tab through 10,000 nodes). The mount set is bounded
to:

1. Elements whose bounding box intersects the current viewport.
2. The focused element ± 2 z-order neighbours.
3. All children of the focused frame, regardless of viewport.
4. The currently-focused element, even if it has scrolled off-screen.

The mount-set selection is O(n) in scene size. With React's stable
element-id keys, a single-element drag in a 5000-element scene produces
a mirror update under 1 ms (see [`__tests__/perf.test.ts`](./__tests__/perf.test.ts)).

A degenerate viewport (0 × 0 dimensions, which happens during the brief
window before layout and in JSDOM tests) falls back to mounting every
element. This prevents the mirror from being briefly empty before the
canvas measures itself.

### i18n / RTL

All strings flow through the existing `t()` pipeline. New keys live
under `labels.a11y.*` in `locales/en.json` and `locales/ar-SA.json`
(the latter to prove the pipeline works in an RTL locale).

The position descriptor (`"top-left of canvas"`) is mirrored on the X
axis for RTL locales: an element on the visual left of the canvas is
described as "top-right" in Arabic / Hebrew, so the screen reader user
hears the position they perceive after the document's RTL flip. The
spatial-nav direction is mirrored the same way — `ArrowLeft` in RTL
moves to the visually-leftmost candidate (which is mathematically to
the right of the current centroid).

## Expected screen-reader behavior

The mirror is designed for the following user-perceived behavior on
NVDA (Windows), JAWS (Windows), and VoiceOver (macOS).

### a. Tab focuses an element

NVDA / JAWS announce the treeitem's accessible name, its role, and its
selection state:

> "Rectangle, top-left of canvas, tree item, 3 of 5, not selected"

VoiceOver announces the same fields, ordered by macOS conventions:

> "Rectangle, top-left of canvas, treeitem, 3 of 5"

These announcements come from the ARIA tree pattern's automatic
exposure of `aria-label`, `aria-level`, `aria-posinset`, and
`aria-setsize` (WAI-ARIA 1.2 §6.7, §5.2.7.2, §5.2.10).

### b. Enter selects the focused element

The polite live region announces:

> "Rectangle selected"

(or `"Text \"Hello\" selected"` for named elements; or
`"3 elements selected"` for multi-select via Shift+Enter).

Per WAI-ARIA 1.2 §5.2.7.4, polite live regions are queued; ATs read the
announcement after the current utterance completes without interrupting
the user.

### c. F2 enters text edit

The live region announces:

> "Editing Text \"Hello\""

(or `"Editing Rectangle"` for an unnamed container.) The wysiwyg
textarea is then focused via the existing canvas text-edit flow, and the
screen reader's text-input mode takes over — character-by-character
reading, cursor positioning, and selection follow the user's keyboard
input naturally.

When text editing finishes (`Esc` or click outside), the live region
announces:

> "Finished editing Text \"Hello\""

### d. Esc returns to the canvas

The live region announces:

> "Selection cleared"

Focus moves to the `.excalidraw-container` element. From there, the
existing canvas keyboard shortcuts (e.g. `Ctrl+A` select-all,
`Cmd+Z` undo) work as before.

## ARIA spec citations

| Behavior | Spec section |
| -------- | ------------ |
| `role="tree"` widget pattern | [WAI-ARIA 1.2 §6.7](https://www.w3.org/TR/wai-aria-1.2/#tree) |
| `role="treeitem"` | [WAI-ARIA 1.2 §5.2.7.2](https://www.w3.org/TR/wai-aria-1.2/#treeitem) |
| `aria-selected` on tree items | [WAI-ARIA 1.2 §6.6.1](https://www.w3.org/TR/wai-aria-1.2/#aria-selected) |
| `aria-multiselectable` | [WAI-ARIA 1.2 §6.6.7](https://www.w3.org/TR/wai-aria-1.2/#aria-multiselectable) |
| `aria-disabled` for locked elements | [WAI-ARIA 1.2 §5.2.10](https://www.w3.org/TR/wai-aria-1.2/#aria-disabled) |
| `aria-level`, `aria-posinset`, `aria-setsize` for tree structure | [WAI-ARIA 1.2 §6.6.5–6.6.10](https://www.w3.org/TR/wai-aria-1.2/#aria-level) |
| `role="status"`, `aria-live="polite"`, `aria-atomic` | [WAI-ARIA 1.2 §5.2.7.4](https://www.w3.org/TR/wai-aria-1.2/#aria-live) |
| Tree keyboard pattern (Tab / arrow / activation) | [ARIA APG: Tree View](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/) (note: Excalidraw uses Tab + spatial arrows, intentionally diverging from the APG default of arrow-only navigation because the canvas is 2D, not a tree). |
| Visually-hidden pattern | [Scott O'Hara: Inclusively hidden](https://www.scottohara.me/blog/2017/04/14/inclusively-hidden.html) |

## What is *not* in scope

- Authoring new elements from scratch via keyboard (we navigate and edit
  existing; we don't author).
- Touch / mobile screen reader (TalkBack, VoiceOver iOS).
- Drawing-tool toolbar a11y (already adequate; untouched).
- Collaboration cursor mirroring or live-announcements of other users'
  edits.

## How to test it locally

1. `yarn start`
2. Open the app in a browser with a screen reader running (NVDA on
   Windows, VoiceOver on macOS via Cmd+F5).
3. Press Tab repeatedly to enter the mirror. The screen reader will
   begin announcing scene elements.
4. Use arrow keys to navigate spatially, Enter to select, F2 to edit
   text, Delete to delete, Esc to return to the canvas.

Visual users will not see any difference — the mirror is clipped via
`clip-path: inset(50%)` and has `pointer-events: none`.
