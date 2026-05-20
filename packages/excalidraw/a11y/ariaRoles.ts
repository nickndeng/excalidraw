import { isTextElement, isFrameLikeElement } from "../element/typeChecks";
import { getBoundTextElement } from "../element/textElement";

import { describeRelativePosition } from "./relativePosition";

import type { Bounds } from "../element/bounds";
import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawElementType,
  ExcalidrawFrameLikeElement,
} from "../element/types";
import type { TranslationKeys } from "../i18n";
import type { AppState } from "../types";

/**
 * ARIA roles used by the accessibility mirror.
 *
 * The mirror is a `listbox` whose entries are `option`s, with frames modeled
 * as `group`s that nest their children's options. `option` and `group` are the
 * roles that (a) participate in listbox selection semantics (`aria-selected`,
 * `aria-multiselectable`) and (b) allow grouping — see WAI-ARIA 1.2 §
 * "listbox", "option", and "group". The element *type* (rectangle, arrow, …)
 * is conveyed through the accessible name rather than the role, because the
 * ARIA roles that carry selection state are a closed set.
 */
export type MirrorRole = "option" | "group";

/**
 * Single source of truth mapping every Excalidraw element type to its mirror
 * ARIA role. Frame-like containers become groups; everything else is a
 * selectable option.
 */
export const ELEMENT_MIRROR_ROLE: Record<ExcalidrawElementType, MirrorRole> = {
  rectangle: "option",
  diamond: "option",
  ellipse: "option",
  text: "option",
  line: "option",
  arrow: "option",
  freedraw: "option",
  image: "option",
  embeddable: "option",
  iframe: "option",
  selection: "option",
  frame: "group",
  magicframe: "group",
};

export const getElementMirrorRole = (element: ExcalidrawElement): MirrorRole =>
  ELEMENT_MIRROR_ROLE[element.type] ?? "option";

/** Localized human label for an element type, e.g. "Rectangle". */
export const getElementTypeLabel = (
  element: ExcalidrawElement,
  t: (
    key: TranslationKeys,
    replacement?: Record<string, string | number>,
  ) => string,
): string => {
  const key = `a11y.elementType.${element.type}` as TranslationKeys;
  // fall back to the generic "element" label for any unmapped/future type
  return t(key, undefined) || t("a11y.elementType.element");
};

/** Collapse newlines/runs of whitespace so multi-line text reads cleanly. */
const normalizeText = (text: string): string =>
  text.replace(/\s+/g, " ").trim();

/**
 * Composes the accessible name from element type + visible text + a localized
 * relative-position descriptor. For text-bearing elements the *full* text
 * content is exposed (no truncation), per requirement.
 */
export const getElementAccessibleName = ({
  element,
  elementsMap,
  frame,
  sceneBounds,
  isRTL,
  t,
}: {
  element: ExcalidrawElement;
  elementsMap: ElementsMap;
  frame: ExcalidrawFrameLikeElement | null;
  sceneBounds: Bounds;
  isRTL: boolean;
  t: (
    key: TranslationKeys,
    replacement?: Record<string, string | number>,
  ) => string;
}): string => {
  const typeLabel = getElementTypeLabel(element, t);

  let core: string;

  if (isTextElement(element)) {
    const text = normalizeText(element.text);
    core = text
      ? t("a11y.name.withText", { type: typeLabel, text })
      : typeLabel;
  } else if (isFrameLikeElement(element)) {
    // the frame's accessible (group) name comes from its label
    core = element.name
      ? t("a11y.name.withText", { type: typeLabel, text: element.name })
      : typeLabel;
  } else {
    const boundText = getBoundTextElement(element, elementsMap);
    const text = boundText ? normalizeText(boundText.text) : "";
    core = text
      ? t("a11y.name.withText", { type: typeLabel, text })
      : typeLabel;
  }

  const position = describeRelativePosition({
    element,
    elementsMap,
    frame,
    sceneBounds,
    isRTL,
    t,
  });

  return t("a11y.name.withPosition", { name: core, position });
};

export type MirrorAriaState = {
  /** reflects appState.selectedElementIds (single source of truth) */
  selected: boolean;
  /** locked elements are exposed as aria-disabled */
  disabled: boolean;
  /** true while the canvas text editor is editing this element */
  editing: boolean;
};

/**
 * Derives the ARIA state attributes for an element from appState. Selection is
 * read directly from `appState.selectedElementIds` — the mirror never keeps a
 * parallel selection set.
 */
export const getElementAriaState = (
  element: ExcalidrawElement,
  appState: Pick<AppState, "selectedElementIds" | "editingTextElement">,
): MirrorAriaState => {
  const editingElement = appState.editingTextElement;
  const editing =
    !!editingElement &&
    (editingElement.id === element.id ||
      // a container whose bound text is being edited
      (isTextElement(editingElement) &&
        editingElement.containerId === element.id));

  return {
    selected: !!appState.selectedElementIds[element.id],
    disabled: !!element.locked,
    editing,
  };
};
