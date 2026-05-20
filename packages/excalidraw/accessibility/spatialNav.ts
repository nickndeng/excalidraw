/**
 * Spatial keyboard navigation for the accessibility mirror.
 *
 * Arrow-key direction picks the nearest element whose centroid lies within
 * a directional cone from the current element's centroid. The cone is
 * symmetric around the cardinal axis with a configurable half-angle
 * (default 30°, total 60° cone).
 *
 * Selection rules:
 *   1. Filter to candidates whose vector from current angle is within
 *      ±halfAngle of the cardinal direction.
 *   2. Of those, pick the candidate with the smallest centroid distance.
 *   3. Tie-break (rare in practice) by lower z-order, then by element id.
 *
 * The directional vector for RTL locales is mirrored on the X axis at the
 * caller level — the caller passes "left" or "right" already swapped.
 */

import type { ExcalidrawElement } from "../element/types";

export type Direction = "up" | "down" | "left" | "right";

type Vec2 = { x: number; y: number };

const DIRECTION_VECTORS: Record<Direction, Vec2> = {
  right: { x: 1, y: 0 },
  // Canvas Y axis is screen-down-positive (same as DOM). "up" decreases y.
  up: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  down: { x: 0, y: 1 },
};

export const DEFAULT_CONE_HALF_ANGLE_RAD = (Math.PI / 180) * 30; // 30° half = 60° cone

const centroid = (el: ExcalidrawElement): Vec2 => ({
  x: el.x + el.width / 2,
  y: el.y + el.height / 2,
});

/**
 * Mirror a direction for RTL locales. Up/Down are unaffected; only the
 * horizontal axis swaps.
 */
export const mirrorDirectionForRTL = (dir: Direction): Direction => {
  if (dir === "left") {
    return "right";
  }
  if (dir === "right") {
    return "left";
  }
  return dir;
};

export type SpatialNeighborInput = {
  current: ExcalidrawElement;
  candidates: readonly ExcalidrawElement[];
  direction: Direction;
  /**
   * Defaults to ±30°. Wider cones reach more candidates at the risk of
   * picking a "kind of to the right" element when a true neighbour exists.
   */
  halfAngleRad?: number;
};

/**
 * Pick the nearest spatial neighbour of `current` in `direction`, or null
 * if none exists in the cone.
 *
 * Complexity: O(n) in candidates. Mirror callers typically pass the
 * currently-mounted set (already virtualized), keeping n small.
 */
export const findSpatialNeighbor = (
  input: SpatialNeighborInput,
): ExcalidrawElement | null => {
  const { current, candidates, direction } = input;
  const halfAngle = input.halfAngleRad ?? DEFAULT_CONE_HALF_ANGLE_RAD;

  const origin = centroid(current);
  const axis = DIRECTION_VECTORS[direction];

  // cos(halfAngle) — anything with dot/|v| >= this is inside the cone.
  const cosLimit = Math.cos(halfAngle);

  let best: ExcalidrawElement | null = null;
  let bestDist = Infinity;

  for (const candidate of candidates) {
    if (candidate.id === current.id) {
      continue;
    }
    if (candidate.isDeleted) {
      continue;
    }

    const c = centroid(candidate);
    const dx = c.x - origin.x;
    const dy = c.y - origin.y;
    const dist = Math.hypot(dx, dy);

    // Coincident centroids: skip. Stacked elements should be reachable
    // via Tab order rather than spatial nav.
    if (dist === 0) {
      continue;
    }

    // Project onto the axis. For the candidate to be in the cone, the
    // projection must be positive AND the angle within halfAngle.
    const projection = dx * axis.x + dy * axis.y;
    if (projection <= 0) {
      continue;
    }

    const cosAngle = projection / dist;
    if (cosAngle < cosLimit) {
      continue;
    }

    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }

  return best;
};
