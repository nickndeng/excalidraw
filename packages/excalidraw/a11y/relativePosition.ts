import { getElementAbsoluteCoords } from "../element/bounds";
import { getFrameLikeTitle } from "../frame";

import type { Bounds } from "../element/bounds";
import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
} from "../element/types";
import type { TranslationKeys } from "../i18n";

/**
 * A coarse 3x3 region of the scene used to describe where an element sits
 * relative to the rest of the drawing for assistive technology.
 */
export type PositionRegion =
  | "topLeft"
  | "top"
  | "topRight"
  | "left"
  | "center"
  | "right"
  | "bottomLeft"
  | "bottom"
  | "bottomRight";

const REGION_GRID: PositionRegion[][] = [
  ["topLeft", "top", "topRight"],
  ["left", "center", "right"],
  ["bottomLeft", "bottom", "bottomRight"],
];

const clampIndex = (value: number) => {
  // guard against NaN (e.g. degenerate geometry / empty freedraw) by defaulting
  // to the middle band, so a missing centroid never crashes name composition
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(2, Math.max(0, value));
};

/**
 * Maps a point (typically an element centroid) onto a 3x3 grid spanning
 * `bounds`. Under RTL the horizontal axis is mirrored so that the descriptor
 * matches the reading direction (the visual left becomes "right" and vice
 * versa), per the i18n/RTL parity requirement.
 *
 * Pure and side-effect free so it can be unit-tested without i18n.
 */
export const getPositionRegion = (
  center: { x: number; y: number },
  bounds: Bounds,
  isRTL = false,
): PositionRegion => {
  const [minX, minY, maxX, maxY] = bounds;
  // guard against degenerate (zero-area) bounds, e.g. a single element
  const width = maxX - minX || 1;
  const height = maxY - minY || 1;

  let col = clampIndex(Math.floor(((center.x - minX) / width) * 3));
  const row = clampIndex(Math.floor(((center.y - minY) / height) * 3));

  if (isRTL) {
    col = 2 - col;
  }

  return REGION_GRID[row][col];
};

/**
 * Builds the localized relative-position descriptor for an element's
 * accessible name, e.g. "top-left of canvas" or "inside frame 'Notes'".
 *
 * `t` and `isRTL` are injected (rather than read from module state) so the
 * descriptor stays a pure function of its inputs and is trivially testable.
 */
export const describeRelativePosition = ({
  element,
  elementsMap,
  frame,
  sceneBounds,
  isRTL,
  t,
}: {
  element: ExcalidrawElement;
  elementsMap: ElementsMap;
  /** the frame the element belongs to, if any */
  frame: ExcalidrawFrameLikeElement | null;
  /** common bounds of the whole scene, precomputed once per render */
  sceneBounds: Bounds;
  isRTL: boolean;
  t: (
    key: TranslationKeys,
    replacement?: Record<string, string | number>,
  ) => string;
}): string => {
  if (frame) {
    return t("a11y.position.insideFrame", { frame: getFrameLikeTitle(frame) });
  }

  const [, , , , cx, cy] = getElementAbsoluteCoords(element, elementsMap);
  const region = getPositionRegion({ x: cx, y: cy }, sceneBounds, isRTL);

  // region is a closed set of literals that all exist under a11y.position.*;
  // cast to a concrete key to satisfy the NestedKeyOf typing of `t`.
  return t(`a11y.position.${region}` as TranslationKeys);
};
