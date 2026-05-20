/**
 * Localized relative-position descriptor.
 *
 * Given an element's bounding box and the current visible viewport, returns
 * a short i18n'd phrase describing where the element sits — e.g. "top-left
 * of canvas" or "inside frame 'Notes'".
 *
 * RTL handling: in right-to-left locales, "left" and "right" are mirrored
 * at the descriptor level via separate translation keys
 * (labels.a11y.position.left vs labels.a11y.position.right) — the *meaning*
 * is preserved (left = leftmost in visual space) but locales like Arabic
 * will name them with the locale's natural left/right words. Spatial
 * navigation does its own L/R swap for RTL (see spatialNav.ts).
 */

import { t, getLanguage } from "../i18n";
import { isFrameElement, isMagicFrameElement } from "../element/typeChecks";
import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  NonDeletedExcalidrawElement,
} from "../element/types";

export type ViewportBounds = {
  /** scene-space coordinates of the visible viewport */
  x: number;
  y: number;
  width: number;
  height: number;
};

type Region =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "center"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right";

/**
 * Classify a centroid into a 3×3 viewport region. The viewport is divided
 * into thirds along each axis; the element's centroid (cx,cy) determines
 * which cell.
 */
const classifyRegion = (
  cx: number,
  cy: number,
  viewport: ViewportBounds,
): Region => {
  const thirdW = viewport.width / 3;
  const thirdH = viewport.height / 3;

  const col =
    cx < viewport.x + thirdW ? 0 : cx < viewport.x + 2 * thirdW ? 1 : 2;
  const row =
    cy < viewport.y + thirdH ? 0 : cy < viewport.y + 2 * thirdH ? 1 : 2;

  const grid: Region[][] = [
    ["top-left", "top", "top-right"],
    ["left", "center", "right"],
    ["bottom-left", "bottom", "bottom-right"],
  ];
  return grid[row][col];
};

const REGION_KEY: Record<Region, string> = {
  "top-left": "labels.a11y.position.topLeft",
  top: "labels.a11y.position.top",
  "top-right": "labels.a11y.position.topRight",
  left: "labels.a11y.position.left",
  center: "labels.a11y.position.center",
  right: "labels.a11y.position.right",
  "bottom-left": "labels.a11y.position.bottomLeft",
  bottom: "labels.a11y.position.bottom",
  "bottom-right": "labels.a11y.position.bottomRight",
};

const mirrorRegionForRTL = (region: Region): Region => {
  switch (region) {
    case "top-left":
      return "top-right";
    case "top-right":
      return "top-left";
    case "left":
      return "right";
    case "right":
      return "left";
    case "bottom-left":
      return "bottom-right";
    case "bottom-right":
      return "bottom-left";
    default:
      return region;
  }
};

/**
 * Resolve the parent frame for an element, if any.
 *
 * We don't import from the heavy frame.ts to keep this module lightweight —
 * a simple Map lookup keyed by frameId is enough.
 */
const findContainingFrame = (
  element: ExcalidrawElement,
  elementsById: ReadonlyMap<string, NonDeletedExcalidrawElement>,
): ExcalidrawFrameLikeElement | null => {
  if (!element.frameId) {
    return null;
  }
  const candidate = elementsById.get(element.frameId);
  if (!candidate || candidate.isDeleted) {
    return null;
  }
  if (isFrameElement(candidate) || isMagicFrameElement(candidate)) {
    return candidate;
  }
  return null;
};

export type PositionDescriptorInput = {
  element: ExcalidrawElement;
  /** Visible viewport in scene coords. */
  viewport: ViewportBounds;
  /** Full element index for frame lookup. */
  elementsById: ReadonlyMap<string, NonDeletedExcalidrawElement>;
};

/**
 * Build the position descriptor string. Always non-empty.
 *
 * Examples (en):
 *   "top-left of canvas"
 *   "center of canvas"
 *   "inside frame 'Notes'"
 *   "inside frame"   (frame has no name)
 *
 * RTL: the L/R names are swapped at the *visual* level so a screen
 * reader user using Hebrew/Arabic hears "top-right" when the element
 * is on the left side of their visually-mirrored canvas.
 */
export const describeElementPosition = (
  input: PositionDescriptorInput,
): string => {
  const { element, viewport, elementsById } = input;

  // Frame containment takes precedence over absolute position — knowing
  // an element is inside a labelled frame is more useful than knowing
  // its quadrant.
  const frame = findContainingFrame(element, elementsById);
  if (frame) {
    if (frame.name) {
      return t("labels.a11y.position.insideNamedFrame", { name: frame.name });
    }
    return t("labels.a11y.position.insideFrame");
  }

  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;

  // If the element's centroid lies outside the current viewport, fall
  // back to a quadrant-of-canvas description using the viewport as the
  // reference frame anyway. This is intentional: positions are reported
  // relative to what the *user* sees, not absolute scene coords.
  let region = classifyRegion(cx, cy, viewport);

  if (getLanguage().rtl) {
    region = mirrorRegionForRTL(region);
  }

  return t(REGION_KEY[region] as Parameters<typeof t>[0]);
};
