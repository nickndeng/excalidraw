/**
 * Build localized announcement strings for the mirror's polite live region.
 *
 * All strings flow through the existing t() i18n pipeline; nothing is
 * hardcoded. The live region is `role="status" aria-live="polite"
 * aria-atomic="true"` — when its textContent changes, ATs queue the new
 * value for speech without interrupting the current utterance (per
 * WAI-ARIA 1.2 §5.2.7.4 and the ARIA live-region authoring practices).
 *
 * The mirror updates the live region's textContent imperatively rather
 * than via React state — that pattern matches the "DOM-as-output"
 * recommendation in https://www.w3.org/TR/wai-aria-1.2/#aria-live and
 * avoids React batching swallowing rapid sequential announcements.
 */

import { t } from "../i18n";
import type { ExcalidrawElement } from "../element/types";
import { getElementTypeLabel, getElementText } from "./roleMapping";

const briefName = (element: ExcalidrawElement): string => {
  const text = getElementText(element);
  if (text) {
    // Truncate to keep announcements concise. NVDA/JAWS will repeat the
    // full label on focus; the announcement is the "what changed" hint.
    const trimmed = text.trim();
    if (trimmed.length <= 40) {
      return t("labels.a11y.announce.namedElement", {
        type: getElementTypeLabel(element),
        text: trimmed,
      });
    }
    return t("labels.a11y.announce.namedElement", {
      type: getElementTypeLabel(element),
      text: `${trimmed.slice(0, 37)}…`,
    });
  }
  return getElementTypeLabel(element);
};

export const announceSelection = (element: ExcalidrawElement): string => {
  return t("labels.a11y.announce.selected", { name: briefName(element) });
};

export const announceDeselection = (element: ExcalidrawElement): string => {
  return t("labels.a11y.announce.deselected", { name: briefName(element) });
};

export const announceMultiSelectionCount = (count: number): string => {
  return t("labels.a11y.announce.multiSelected", { count });
};

export const announceEditStart = (element: ExcalidrawElement): string => {
  return t("labels.a11y.announce.editStart", { name: briefName(element) });
};

export const announceEditEnd = (element: ExcalidrawElement): string => {
  return t("labels.a11y.announce.editEnd", { name: briefName(element) });
};

export const announceDeletion = (count: number): string => {
  if (count === 1) {
    return t("labels.a11y.announce.deletedOne");
  }
  return t("labels.a11y.announce.deletedMany", { count });
};

export const announceCleared = (): string => {
  return t("labels.a11y.announce.selectionCleared");
};
