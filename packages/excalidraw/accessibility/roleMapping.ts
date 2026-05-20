/**
 * Single source of truth for mapping an Excalidraw element to its ARIA
 * representation in the accessibility mirror.
 *
 * Every selectable scene element renders as a `role="treeitem"` inside a
 * `role="tree"` container with `aria-multiselectable="true"`. This is the
 * WAI-ARIA 1.2 tree pattern (§6.7) — it natively supports selection,
 * hierarchy (frames → children), multi-select, and a roving-tabindex
 * keyboard model.
 *
 * The accessible name is composed of:
 *   <element-type-label> + <text-content?> + <position-descriptor>
 *
 * For text-bearing elements the visible text is the primary name (per the
 * "name from author" pattern, ARIA 1.2 §5.2.7.5). For shape elements with
 * no inherent text we synthesize a localized type label.
 *
 * ARIA state mapping:
 *   - selected -> aria-selected="true"
 *   - locked   -> aria-disabled="true"
 *   - editing  -> data-editing="true" + appended " (editing)" label
 *
 * @see https://www.w3.org/TR/wai-aria-1.2/#tree
 * @see https://www.w3.org/TR/wai-aria-1.2/#treeitem
 */

import { t } from "../i18n";
import {
  isArrowElement,
  isEmbeddableElement,
  isFrameElement,
  isFreeDrawElement,
  isIframeElement,
  isImageElement,
  isLinearElement,
  isMagicFrameElement,
  isTextElement,
} from "../element/typeChecks";
import type { ExcalidrawElement } from "../element/types";

/**
 * Locked elements use aria-disabled. Frames are the only element type that
 * exposes a `role="group"` wrapper for its children; everything else is a
 * leaf treeitem.
 */
export type MirrorRole = "treeitem";

export type MirrorAriaState = {
  selected: boolean;
  disabled: boolean;
  editing: boolean;
};

export type MirrorNodeDescriptor = {
  /**
   * Always "treeitem" for selectable scene elements. Frames are also
   * treeitems but additionally render an `aria-owns`-linked group of
   * children, handled by the renderer (not this helper).
   */
  role: MirrorRole;
  /**
   * Full accessible name. Localized via t(). Never contains untrusted HTML.
   */
  ariaLabel: string;
  /**
   * For text-bearing elements: the raw visible text. Renderer may expose
   * this as the textContent so screen readers can read it character-by-
   * character during arrow-key reading mode.
   */
  textContent: string | null;
  ariaState: MirrorAriaState;
};

/**
 * Localized human-readable type label for an element. Centralized so
 * the renderer never branches on element.type itself.
 */
export const getElementTypeLabel = (element: ExcalidrawElement): string => {
  if (isFrameElement(element)) {
    return t("labels.a11y.element.frame");
  }
  if (isMagicFrameElement(element)) {
    return t("labels.a11y.element.magicframe");
  }
  if (isTextElement(element)) {
    return t("labels.a11y.element.text");
  }
  if (isImageElement(element)) {
    return t("labels.a11y.element.image");
  }
  if (isFreeDrawElement(element)) {
    return t("labels.a11y.element.freedraw");
  }
  if (isArrowElement(element)) {
    return t("labels.a11y.element.arrow");
  }
  if (isLinearElement(element)) {
    return t("labels.a11y.element.line");
  }
  if (isIframeElement(element)) {
    return t("labels.a11y.element.iframe");
  }
  if (isEmbeddableElement(element)) {
    return t("labels.a11y.element.embeddable");
  }
  switch (element.type) {
    case "rectangle":
      return t("labels.a11y.element.rectangle");
    case "diamond":
      return t("labels.a11y.element.diamond");
    case "ellipse":
      return t("labels.a11y.element.ellipse");
    case "selection":
      // Selection rectangle is a UI artifact — never mirrored. We still
      // return a label so callers that don't filter selection elements
      // don't crash.
      return t("labels.a11y.element.selection");
    default:
      // Exhaustiveness: any new element type must add a localized label.
      // We deliberately return the raw type as a fallback (in dev this
      // will surface as a missing-translation throw via t()).
      return (element as ExcalidrawElement).type;
  }
};

/**
 * Visible text for elements that carry text. Returns null for shapes
 * with no text.
 *
 * Frames return their name; text elements return their `text` (the
 * laid-out / wrapped form, which is what's visible on the canvas).
 */
export const getElementText = (element: ExcalidrawElement): string | null => {
  if (isTextElement(element)) {
    return element.text || null;
  }
  if (isFrameElement(element) || isMagicFrameElement(element)) {
    return element.name || null;
  }
  return null;
};

export type MirrorAriaInput = {
  element: ExcalidrawElement;
  /** Localized relative-position descriptor, e.g. "top-left of canvas". */
  positionDescriptor: string;
  /** Is the element in the current selection? */
  isSelected: boolean;
  /** Is text-edit active on this element right now? */
  isEditing: boolean;
};

/**
 * Build the complete ARIA descriptor for a mirror node.
 *
 * Locked elements report `aria-disabled` per ARIA 1.2 §5.2.10 — they
 * remain focusable (so screen reader users can navigate to them) but
 * indicate that activation/selection won't take effect.
 */
export const getMirrorDescriptor = (
  input: MirrorAriaInput,
): MirrorNodeDescriptor => {
  const { element, positionDescriptor, isSelected, isEditing } = input;

  const typeLabel = getElementTypeLabel(element);
  const text = getElementText(element);

  // Build accessible name. Order: type, text (if any), position, editing.
  // We use t("labels.a11y.nodeLabel.*") templates so the joining
  // punctuation and word order can be localized.
  let ariaLabel: string;
  if (text) {
    ariaLabel = t("labels.a11y.nodeLabel.withText", {
      type: typeLabel,
      text,
      position: positionDescriptor,
    });
  } else {
    ariaLabel = t("labels.a11y.nodeLabel.plain", {
      type: typeLabel,
      position: positionDescriptor,
    });
  }

  if (isEditing) {
    ariaLabel = t("labels.a11y.nodeLabel.editingSuffix", { label: ariaLabel });
  }

  return {
    role: "treeitem",
    ariaLabel,
    textContent: text,
    ariaState: {
      selected: isSelected,
      disabled: element.locked,
      editing: isEditing,
    },
  };
};
