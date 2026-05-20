/**
 * Pure spatial (directional) navigation for the accessibility mirror.
 *
 * Arrow keys move focus to the nearest element whose centroid lies within a
 * 60° cone (±30° around the axis) in the requested direction, breaking ties on
 * centroid distance. Coordinates are scene coordinates where +y points down,
 * matching the canvas.
 */

export type Direction = "left" | "right" | "up" | "down";

export type SpatialItem = {
  id: string;
  center: { x: number; y: number };
};

/** Axis angle (degrees) per direction in screen coordinates (+y is down). */
const DIRECTION_ANGLE: Record<Direction, number> = {
  right: 0,
  down: 90,
  left: 180,
  up: -90,
};

/** Half-angle of the directional cone (full cone = 60°). */
const HALF_CONE_DEGREES = 30;

const EPSILON = 1e-6;

/** Normalize an angle in degrees to the range (-180, 180]. */
const normalizeAngle = (angle: number): number => {
  let result = angle % 360;
  if (result > 180) {
    result -= 360;
  }
  if (result <= -180) {
    result += 360;
  }
  return result;
};

/**
 * Returns the id of the nearest element to `currentId` in `direction`, or null
 * if nothing falls within the cone.
 *
 * Under RTL, horizontal directions are swapped so that ArrowRight/ArrowLeft
 * follow reading order (the i18n/RTL parity requirement).
 *
 * Deterministic: ties on distance are broken by smaller angular deviation,
 * then by id, so navigation never loops or depends on input ordering.
 */
export const findSpatialNeighbor = (
  items: readonly SpatialItem[],
  currentId: string,
  direction: Direction,
  options: { isRTL?: boolean } = {},
): string | null => {
  const resolvedDirection: Direction = options.isRTL
    ? direction === "left"
      ? "right"
      : direction === "right"
      ? "left"
      : direction
    : direction;

  const current = items.find((item) => item.id === currentId);
  if (!current) {
    return null;
  }

  const axis = DIRECTION_ANGLE[resolvedDirection];

  let bestId: string | null = null;
  let bestDistance = Infinity;
  let bestDeviation = Infinity;

  for (const item of items) {
    if (item.id === currentId) {
      continue;
    }

    const dx = item.center.x - current.center.x;
    const dy = item.center.y - current.center.y;

    // coincident centroids carry no direction
    if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) {
      continue;
    }

    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const deviation = Math.abs(normalizeAngle(angle - axis));

    if (deviation > HALF_CONE_DEGREES) {
      continue;
    }

    const distance = Math.hypot(dx, dy);

    const closer = distance < bestDistance - EPSILON;
    const tieButStraighter =
      Math.abs(distance - bestDistance) <= EPSILON &&
      (deviation < bestDeviation - EPSILON ||
        (Math.abs(deviation - bestDeviation) <= EPSILON &&
          (bestId === null || item.id < bestId)));

    if (closer || tieButStraighter) {
      bestId = item.id;
      bestDistance = distance;
      bestDeviation = deviation;
    }
  }

  return bestId;
};
