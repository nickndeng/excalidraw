# Accessibility mirror — screen-reader behavior

The accessibility mirror exposes the canvas scene (which is otherwise drawn to
an opaque `<canvas>` and invisible to assistive technology) as a hidden,
focusable DOM tree with full ARIA semantics and keyboard navigation. It ships
on by default in `<Excalidraw>` and can be turned off with
`accessibilityMirror={false}`.

This document specifies what a screen reader should announce, and cites the
WAI-ARIA 1.2 specification sections and the ARIA Authoring Practices Guide
(APG) that justify the chosen pattern.

## ARIA structure

```
<div role="listbox" aria-multiselectable="true" aria-label="Canvas elements"
     aria-describedby="…instructions">
  <span …instructions>Use Tab to move through elements…</span>   (clipped)
  <div role="option"  aria-selected="false">Rectangle, top-left of canvas</div>
  <div role="group"   aria-label="Frame: Notes, center of canvas">
    <div role="option" aria-selected="true">Text: Hello, inside frame 'Notes'</div>
  </div>
  …
</div>
<div role="status" aria-live="polite" aria-atomic="true">…announcements…</div>
```

- **`role="listbox"` + `aria-multiselectable="true"`** — the container is a
  multi-select listbox. WAI-ARIA 1.2 §
  [`listbox`](https://www.w3.org/TR/wai-aria-1.2/#listbox) and §
  [`aria-multiselectable`](https://www.w3.org/TR/wai-aria-1.2/#aria-multiselectable).
  See also APG
  [Listbox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/).
- **`role="option"`** for each element — options are the selectable children of
  a listbox and are the navigable role that carries selection state. WAI-ARIA
  1.2 § [`option`](https://www.w3.org/TR/wai-aria-1.2/#option). The element
  *type* (rectangle, arrow, image…) is carried in the **accessible name**,
  because the ARIA roles that support `aria-selected` are a closed set; the
  type→role mapping lives in `ariaRoles.ts`.
- **`role="group"`** for frames, nesting their children's options, with an
  accessible name taken from the frame label. WAI-ARIA 1.2 §
  [`group`](https://www.w3.org/TR/wai-aria-1.2/#group). A listbox may own
  `group`s that own `option`s.
- **`aria-selected`** mirrors `appState.selectedElementIds` on every option
  (always present, `true`/`false`, as required for a multi-select listbox).
  WAI-ARIA 1.2 § [`aria-selected`](https://www.w3.org/TR/wai-aria-1.2/#aria-selected).
- **`aria-disabled="true"`** for locked elements. WAI-ARIA 1.2 §
  [`aria-disabled`](https://www.w3.org/TR/wai-aria-1.2/#aria-disabled).
- **`aria-describedby`** points the focused option at a clipped "editing" node
  while the canvas text editor is active (there is no standard `aria-editing`
  state). WAI-ARIA 1.2 §
  [`aria-describedby`](https://www.w3.org/TR/wai-aria-1.2/#aria-describedby).
- **`role="status"` + `aria-live="polite"` + `aria-atomic="true"`** — a polite
  live region announces selection changes, text-edit start/finish, and
  deletions in the active locale. WAI-ARIA 1.2 §
  [`aria-live`](https://www.w3.org/TR/wai-aria-1.2/#aria-live), §
  [`status`](https://www.w3.org/TR/wai-aria-1.2/#status), §
  [`aria-atomic`](https://www.w3.org/TR/wai-aria-1.2/#aria-atomic).

The mirror is clipped off-screen (1×1px, `clip-path: inset(50%)`,
`pointer-events: none`) rather than `display:none`/`visibility:hidden`/
`opacity:0`, so it remains in the accessibility tree (`aria-hidden` stays
`false`) per WAI-ARIA 1.2 §
[`aria-hidden`](https://www.w3.org/TR/wai-aria-1.2/#aria-hidden).

## Expected announcements (NVDA / VoiceOver)

### (a) Tab focuses an element

Focus lands on a `role="option"`. A screen reader announces the option's
**accessible name** followed by its **selected state** and its position within
the listbox, e.g.:

> "Rectangle, top-left of canvas, not selected, list item"
> (VoiceOver: "Rectangle, top-left of canvas, option")

This is the standard option announcement defined by the name computation
(WAI-ARIA 1.2 §
[Accessible Name and Description Computation](https://www.w3.org/TR/accname-1.2/))
and the `aria-selected` state. Arrow keys then perform 2-D spatial navigation;
`Tab`/`Shift+Tab` walk the elements in z-order (frame children nested before
the next sibling).

### (b) Enter selects it

`Enter` toggles `appState.selectedElementIds`; the option's `aria-selected`
flips to `true`/`false`. Screen readers announce the changed selection state of
the focused option ("selected"), and the polite live region additionally
announces:

> "Selected Rectangle, top-left of canvas"

Justification: state change on `aria-selected` (WAI-ARIA 1.2 §
[`aria-selected`](https://www.w3.org/TR/wai-aria-1.2/#aria-selected)) plus a
polite live-region message that does not interrupt the user (WAI-ARIA 1.2 §
[`aria-live`](https://www.w3.org/TR/wai-aria-1.2/#aria-live)). `Shift+Enter`
adds/removes from a multi-selection without clearing the rest.

### (c) F2 enters text edit

`F2` selects the element and opens the existing canvas text editor (a real
`<textarea>`); DOM focus moves there so typed keystrokes are routed to the
editor, not the mirror. The live region announces:

> "Editing Text: Hello, inside frame 'Notes'"

While editing, the element's option carries `aria-describedby` → a localized
"editing" description (WAI-ARIA 1.2 §
[`aria-describedby`](https://www.w3.org/TR/wai-aria-1.2/#aria-describedby)).
When editing ends the live region announces "Finished editing …".

### (d) Esc returns to the canvas

`Esc` clears the selection (live region: "Selection cleared") and returns DOM
focus to the canvas container — a `tabIndex=0` region — so the user can pan/zoom
or `Tab` back into the mirror. Returning focus to a managed container follows
the focus-management guidance in the APG
([Developing a Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)).

## Keyboard model

| Key | Action |
| --- | --- |
| `Tab` / `Shift+Tab` | Move through elements in z-order (frame children nested) |
| `→ ← ↑ ↓` | Spatial navigation: nearest element within a 60° cone in that direction (mirrored under RTL) |
| `Enter` | Toggle selection of the focused element |
| `Shift+Enter` | Add/remove the focused element from a multi-selection |
| `F2` | Edit text of a text-bearing element |
| `Delete` / `Backspace` | Delete the selected element(s) |
| `Esc` | Clear selection and return focus to the canvas |

All keys are delegated from the single canvas keyboard pipeline
(`App.onKeyDown`): the mirror registers one handle and consumes an event only
when focus is inside it. `Delete`/`Backspace` and undo/redo/select-all fall
through to the existing `actionManager`, so there is no parallel keymap and
`appState.selectedElementIds` stays the single source of truth for selection.

## i18n / RTL

Every string is produced via the existing `t()` pipeline; keys live under
`a11y.*` in `locales/en.json` and `locales/ar-SA.json` (Arabic, RTL). Under
`dir="rtl"`, relative-position descriptors are mirrored (the visual left is
described as "right" and vice-versa) and `→`/`←` spatial navigation follows
reading order.

## Design decisions / assumptions

- **Frames are ARIA `group`s, not focusable options.** A frame contributes a
  named group container; navigation moves among its child elements. (An empty
  frame is therefore not itself a focus target.)
- **Focus does not chase canvas pan/scroll.** The focused element is always
  force-mounted, so keyboard focus is never lost when it scrolls out of view.
  Canvas-driven selection moves the mirror's focus *pointer* to the first
  selected element, but only steals DOM focus if the mirror already had it
  (clicking on the canvas never yanks focus into the hidden mirror).
- **Virtualization.** Only viewport-intersecting elements, the focused element
  plus one z-order neighbor on each side, the focused frame's children, and the
  current selection are mounted; updates are incremental (React keyed
  reconciliation + per-node memoization), keeping a 5000-element drag well under
  one animation frame.
