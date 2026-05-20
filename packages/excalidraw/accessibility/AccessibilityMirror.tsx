/**
 * Hidden DOM mirror of the scene for assistive technology.
 *
 * Rendered as a `role="tree"` with one `role="treeitem"` per mounted
 * scene element. The mirror is visually clipped off-screen but exposed
 * to the accessibility tree (see AccessibilityMirror.scss).
 *
 * Selection state, deletion, and text-edit all route through the existing
 * App / appState — this component never holds a parallel selection set.
 *
 * Performance:
 *   - The mount set is computed via computeMirrorMountSet (virtualized).
 *   - React keys = element.id, so element field changes (drag, edit)
 *     update the existing DOM node rather than remounting.
 *   - The mount-set computation is memoized on element list + viewport +
 *     focus, so a single-element drag in a 5000-element scene only does
 *     O(n) bbox-intersect tests (no DOM diff churn).
 *
 * Keyboard model:
 *   - Tab / Shift+Tab — next/prev treeitem in z-order (intercepted).
 *   - Arrow keys     — spatial nav via 60° directional cones.
 *   - Enter          — toggle selection (Shift+Enter = additive).
 *   - F2             — begin text edit (text elements + text containers).
 *   - Delete/Bksp    — delete selected elements via actionDeleteSelected.
 *   - Esc            — clear selection + return focus to canvas.
 *
 * @see https://www.w3.org/TR/wai-aria-1.2/#tree
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { KEYS } from "../keys";
import { useI18n, getLanguage } from "../i18n";
import type { AppState, AppClassProperties } from "../types";
import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "../element/types";
import {
  isFrameElement,
  isMagicFrameElement,
  isTextElement,
} from "../element/typeChecks";
import { isValidTextContainer } from "../element/textElement";
import { actionDeleteSelected } from "../actions/actionDeleteSelected";

import { getMirrorDescriptor } from "./roleMapping";
import { describeElementPosition } from "./position";
import {
  findSpatialNeighbor,
  mirrorDirectionForRTL,
  type Direction,
} from "./spatialNav";
import { computeMirrorMountSet, type ViewportBounds } from "./virtualization";
import {
  announceCleared,
  announceDeletion,
  announceEditStart,
  announceMultiSelectionCount,
  announceSelection,
} from "./announcer";

import "./AccessibilityMirror.scss";

export type AccessibilityMirrorProps = {
  app: AppClassProperties;
  elements: readonly NonDeletedExcalidrawElement[];
  appState: AppState;
};

/**
 * Compute the visible viewport in scene coordinates from current
 * appState.
 *
 * The interactive canvas covers (0..width, 0..height) in viewport pixels.
 * To convert to scene coords we use:
 *   sceneX = (vx - scrollX * zoom) / zoom   (where vx is in CSS pixels)
 *   but Excalidraw uses the simpler form: sceneX = (vx / zoom) - scrollX
 * (see utils.viewportCoordsToSceneCoords)
 */
const computeViewportBounds = (appState: AppState): ViewportBounds => {
  const zoom = appState.zoom.value || 1;
  const widthScene = appState.width / zoom;
  const heightScene = appState.height / zoom;
  return {
    x: -appState.scrollX,
    y: -appState.scrollY,
    width: widthScene,
    height: heightScene,
  };
};

/**
 * Build an O(1)-lookup index of non-deleted elements by id.
 *
 * This is hot in the inner loops (position descriptor needs frame lookup,
 * keyboard nav needs current-element lookup) — exposing the Map directly
 * is cheaper than calling Scene.getElement (which goes through a Map of
 * including-deleted elements).
 */
const indexElementsById = (
  elements: readonly NonDeletedExcalidrawElement[],
): ReadonlyMap<string, NonDeletedExcalidrawElement> => {
  const map = new Map<string, NonDeletedExcalidrawElement>();
  for (const el of elements) {
    map.set(el.id, el);
  }
  return map;
};

/**
 * Find the first selected element ID (in z-order). Used to drive
 * roving-tabindex focus from canvas-driven selection.
 */
const firstSelectedId = (
  elements: readonly NonDeletedExcalidrawElement[],
  selectedElementIds: AppState["selectedElementIds"],
): string | null => {
  for (const el of elements) {
    if (selectedElementIds[el.id]) {
      return el.id;
    }
  }
  return null;
};

const AccessibilityMirrorBase = (props: AccessibilityMirrorProps) => {
  const { app, elements, appState } = props;
  // Subscribe to i18n changes so the mirror re-renders when locale flips.
  useI18n();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const liveRegionRef = useRef<HTMLDivElement | null>(null);
  const treeItemRefs = useRef(new Map<string, HTMLDivElement | null>());

  // Internal "focused element id" — this is *only* a focus pointer, not a
  // selection. Always derived from selectedElementIds when the canvas
  // drives the change; only mutated independently when the user navigates
  // via arrow/Tab without selecting.
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const isRTL = getLanguage().rtl ?? false;

  // ---- Derived data, memoized to keep the perf budget. ---------------

  const elementsById = useMemo(() => indexElementsById(elements), [elements]);

  // We only re-compute the viewport when scroll/zoom/size change.
  // Other fields of appState are intentionally excluded from the dep
  // list — pulling the whole appState in would defeat the memo.
  const { scrollX, scrollY, zoom, width, height } = appState;
  const viewport = useMemo(
    () =>
      computeViewportBounds({
        scrollX,
        scrollY,
        zoom,
        width,
        height,
      } as AppState),
    [scrollX, scrollY, zoom, width, height],
  );

  const mountedElements = useMemo(
    () =>
      computeMirrorMountSet({
        elements,
        viewport,
        focusedElementId: focusedId,
      }),
    [elements, viewport, focusedId],
  );

  // ---- Selection-driven focus sync ----------------------------------
  //
  // When selection changes on the canvas, move mirror focus to match.
  // We never *call* element.focus() in response to a canvas-only update
  // unless the mirror was already focused — otherwise we'd steal focus
  // from sighted users every time they click a shape.
  useEffect(() => {
    const selectedFirst = firstSelectedId(
      elements,
      appState.selectedElementIds,
    );
    if (selectedFirst && selectedFirst !== focusedId) {
      setFocusedId(selectedFirst);
    } else if (!selectedFirst && focusedId) {
      // Selection cleared externally — keep focusedId so user can still
      // tab back to "where they were" until something else moves focus.
    }
  }, [appState.selectedElementIds, elements, focusedId]);

  // ---- Imperative live-region announcements -------------------------
  //
  // We track the previously-announced selection so we only fire on
  // user-perceived changes (not every state echo).
  const lastAnnouncedSelectionRef = useRef<string>("");
  useEffect(() => {
    const node = liveRegionRef.current;
    if (!node) {
      return;
    }
    const selectedIds = Object.keys(appState.selectedElementIds);
    const key = selectedIds.sort().join(",");
    if (key === lastAnnouncedSelectionRef.current) {
      return;
    }
    lastAnnouncedSelectionRef.current = key;

    if (selectedIds.length === 0) {
      node.textContent = announceCleared();
    } else if (selectedIds.length === 1) {
      const el = elementsById.get(selectedIds[0]);
      if (el) {
        node.textContent = announceSelection(el);
      }
    } else {
      node.textContent = announceMultiSelectionCount(selectedIds.length);
    }
  }, [appState.selectedElementIds, elementsById]);

  // Announce edit-start when editingTextElement changes.
  const lastEditingIdRef = useRef<string | null>(null);
  useEffect(() => {
    const node = liveRegionRef.current;
    if (!node) {
      return;
    }
    const editingId = appState.editingTextElement?.id ?? null;
    if (editingId !== lastEditingIdRef.current) {
      lastEditingIdRef.current = editingId;
      if (editingId) {
        const el = elementsById.get(editingId);
        if (el) {
          // Use a microtask so the editing label is read AFTER the
          // selection announcement that typically precedes it.
          queueMicrotask(() => {
            if (liveRegionRef.current) {
              liveRegionRef.current.textContent = announceEditStart(el);
            }
          });
        }
      }
    }
  }, [appState.editingTextElement, elementsById]);

  // ---- Selection mutations ------------------------------------------
  //
  // The mirror is the sole entry point for these mutations; the canvas
  // continues to use its own pathways. Both eventually update
  // appState.selectedElementIds so there is no parallel state.
  const selectOnly = useCallback(
    (id: string) => {
      app.setMirrorAppState({
        selectedElementIds: { [id]: true },
        selectedGroupIds: {},
      });
    },
    [app],
  );

  const toggleSelection = useCallback(
    (id: string, additive: boolean) => {
      const current = appState.selectedElementIds;
      const isAlready = !!current[id];
      let next: { [id: string]: true };
      if (additive) {
        next = { ...current };
        if (isAlready) {
          delete next[id];
        } else {
          next[id] = true;
        }
      } else {
        next =
          isAlready && Object.keys(current).length === 1 ? {} : { [id]: true };
      }
      app.setMirrorAppState({
        selectedElementIds: next,
        selectedGroupIds: {},
      });
    },
    [app, appState.selectedElementIds],
  );

  const clearSelectionAndReturnToCanvas = useCallback(() => {
    app.setMirrorAppState({
      selectedElementIds: {},
      selectedGroupIds: {},
    });
    app.focusContainer();
  }, [app]);

  // ---- Delete ---------------------------------------------------------
  //
  // Route through the existing action — same code path as canvas-Delete.
  // This guarantees history-entry parity ("one history entry per
  // user-perceived action").
  const deleteSelected = useCallback(() => {
    const node = liveRegionRef.current;
    const selectedCount = Object.keys(appState.selectedElementIds).length;
    if (selectedCount === 0) {
      return;
    }
    app.actionManager.executeAction(actionDeleteSelected);
    if (node) {
      node.textContent = announceDeletion(selectedCount);
    }
  }, [app, appState.selectedElementIds]);

  // ---- Text edit (F2) ------------------------------------------------
  //
  // Delegates to App's public mirror-API helper. For containers with no
  // bound text, this creates a new text element; for text elements and
  // containers with bound text, it begins editing the existing text.
  const beginTextEdit = useCallback(
    (element: ExcalidrawElement) => {
      if (isTextElement(element) || isValidTextContainer(element)) {
        app.beginTextEditForElement(element);
      }
    },
    [app],
  );

  // ---- Focus management ---------------------------------------------

  const focusElement = useCallback((id: string | null) => {
    setFocusedId(id);
    if (id) {
      // Defer focus() until after the render so the treeitem exists in
      // the DOM. We can't always rely on it being in the mount set
      // (e.g. user tabs to an offscreen item) — when needed, the mount
      // set re-computes and includes the focused id via the focus-
      // neighbour rule.
      queueMicrotask(() => {
        const node = treeItemRefs.current.get(id);
        if (node) {
          node.focus({ preventScroll: true });
        }
      });
    }
  }, []);

  // Tab cycles within the mirror by z-order. We rely on the mountedElements
  // ordering, which already runs depth-first through frames so frame
  // children come before next siblings.
  const cycleZOrder = useCallback(
    (currentId: string, direction: 1 | -1) => {
      // First try within the mounted set for fast path…
      const mountedIds = mountedElements.map((el) => el.id);
      const idxMounted = mountedIds.indexOf(currentId);
      if (idxMounted !== -1) {
        const next = idxMounted + direction;
        if (next >= 0 && next < mountedIds.length) {
          focusElement(mountedIds[next]);
          return;
        }
      }
      // Fall back to the full z-order: this triggers a re-mount via the
      // focus-neighbour rule.
      const allIdx = elements.findIndex((el) => el.id === currentId);
      if (allIdx === -1) {
        return;
      }
      const next = allIdx + direction;
      if (next >= 0 && next < elements.length) {
        focusElement(elements[next].id);
      }
    },
    [elements, mountedElements, focusElement],
  );

  const handleArrowNav = useCallback(
    (currentId: string, rawDir: Direction) => {
      const current = elementsById.get(currentId);
      if (!current) {
        return;
      }
      const dir = isRTL ? mirrorDirectionForRTL(rawDir) : rawDir;
      const candidates = mountedElements;
      const neighbor = findSpatialNeighbor({
        current,
        candidates,
        direction: dir,
      });
      if (neighbor) {
        focusElement(neighbor.id);
      }
    },
    [elementsById, focusElement, isRTL, mountedElements],
  );

  // ---- Keyboard handler --------------------------------------------

  const onTreeItemKeyDown = useCallback(
    (
      event: React.KeyboardEvent<HTMLDivElement>,
      element: ExcalidrawElement,
    ) => {
      // Every key handled by the mirror is "consumed" — we stop
      // propagation so the canvas-level onKeyDown does not double-handle
      // it. Without this, e.g. Enter on a selected rectangle would also
      // start the canvas text editor, defeating our selection semantics.
      // Delete still routes through the action manager explicitly, so
      // canvas-side Delete is not invoked twice.
      const consume = () => {
        event.preventDefault();
        event.stopPropagation();
      };

      if (event.key === KEYS.TAB) {
        consume();
        cycleZOrder(element.id, event.shiftKey ? -1 : 1);
        return;
      }
      if (event.key === KEYS.ARROW_RIGHT) {
        consume();
        handleArrowNav(element.id, "right");
        return;
      }
      if (event.key === KEYS.ARROW_LEFT) {
        consume();
        handleArrowNav(element.id, "left");
        return;
      }
      if (event.key === KEYS.ARROW_UP) {
        consume();
        handleArrowNav(element.id, "up");
        return;
      }
      if (event.key === KEYS.ARROW_DOWN) {
        consume();
        handleArrowNav(element.id, "down");
        return;
      }
      if (event.key === KEYS.ENTER) {
        consume();
        toggleSelection(element.id, event.shiftKey);
        return;
      }
      if (event.key === "F2") {
        consume();
        beginTextEdit(element);
        return;
      }
      if (event.key === KEYS.DELETE || event.key === KEYS.BACKSPACE) {
        consume();
        if (!appState.selectedElementIds[element.id]) {
          selectOnly(element.id);
          queueMicrotask(deleteSelected);
        } else {
          deleteSelected();
        }
        return;
      }
      if (event.key === KEYS.ESCAPE) {
        consume();
        clearSelectionAndReturnToCanvas();
      }
    },
    [
      appState.selectedElementIds,
      beginTextEdit,
      clearSelectionAndReturnToCanvas,
      cycleZOrder,
      deleteSelected,
      handleArrowNav,
      selectOnly,
      toggleSelection,
    ],
  );

  // ---- Render --------------------------------------------------------

  const { t } = useI18n();

  // Roving tabindex: the focused item (or first item if nothing focused)
  // is tabindex=0; others -1.
  const effectiveFocusId =
    focusedId && elementsById.has(focusedId)
      ? focusedId
      : mountedElements.length > 0
      ? mountedElements[0].id
      : null;

  return (
    <div
      ref={containerRef}
      className="excalidraw-a11y-mirror"
      role="tree"
      aria-label={t("labels.a11y.mirrorLabel")}
      aria-multiselectable="true"
      aria-orientation="vertical"
      data-testid="excalidraw-a11y-mirror"
    >
      <div
        ref={liveRegionRef}
        className="excalidraw-a11y-live-region"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={t("labels.a11y.liveRegionLabel")}
        data-testid="excalidraw-a11y-live-region"
      />
      <MirrorTree
        elements={mountedElements}
        elementsById={elementsById}
        viewport={viewport}
        selectedElementIds={appState.selectedElementIds}
        editingElementId={appState.editingTextElement?.id ?? null}
        focusedElementId={effectiveFocusId}
        treeItemRefs={treeItemRefs}
        onKeyDown={onTreeItemKeyDown}
      />
    </div>
  );
};

/**
 * MirrorTree is split out so the heavy descriptor computation only runs
 * when its inputs actually change — selection updates that don't affect
 * the mount set will not re-render unaffected items because each item
 * is React.memo'd by its id and its specific subset of props.
 */
type MirrorTreeProps = {
  elements: readonly NonDeletedExcalidrawElement[];
  elementsById: ReadonlyMap<string, NonDeletedExcalidrawElement>;
  viewport: ViewportBounds;
  selectedElementIds: AppState["selectedElementIds"];
  editingElementId: string | null;
  focusedElementId: string | null;
  treeItemRefs: React.MutableRefObject<Map<string, HTMLDivElement | null>>;
  onKeyDown: (
    e: React.KeyboardEvent<HTMLDivElement>,
    el: ExcalidrawElement,
  ) => void;
};

const MirrorTree = (props: MirrorTreeProps) => {
  const {
    elements,
    elementsById,
    viewport,
    selectedElementIds,
    editingElementId,
    focusedElementId,
    treeItemRefs,
    onKeyDown,
  } = props;

  // Group children by frame for nested rendering.
  const mountedFrameIds = new Set<string>();
  for (const el of elements) {
    if (isFrameElement(el) || isMagicFrameElement(el)) {
      mountedFrameIds.add(el.id);
    }
  }

  // Quick index: which top-level items to render at root (i.e. not
  // a child of a mounted frame), and which children belong to which
  // mounted frame.
  const childrenByFrame = new Map<string, NonDeletedExcalidrawElement[]>();
  const topLevel: NonDeletedExcalidrawElement[] = [];
  for (const el of elements) {
    if (el.frameId && mountedFrameIds.has(el.frameId)) {
      let list = childrenByFrame.get(el.frameId);
      if (!list) {
        list = [];
        childrenByFrame.set(el.frameId, list);
      }
      list.push(el);
    } else {
      topLevel.push(el);
    }
  }

  return (
    <>
      {topLevel.map((el, idx) => (
        <MirrorTreeNode
          key={el.id}
          element={el}
          elementsById={elementsById}
          viewport={viewport}
          isSelected={!!selectedElementIds[el.id]}
          isEditing={editingElementId === el.id}
          isFocused={focusedElementId === el.id}
          posInSet={idx + 1}
          setSize={topLevel.length}
          level={1}
          treeItemRefs={treeItemRefs}
          onKeyDown={onKeyDown}
          childrenElements={childrenByFrame.get(el.id) ?? null}
          selectedElementIds={selectedElementIds}
          editingElementId={editingElementId}
          focusedElementId={focusedElementId}
        />
      ))}
    </>
  );
};

type MirrorTreeNodeProps = {
  element: NonDeletedExcalidrawElement;
  elementsById: ReadonlyMap<string, NonDeletedExcalidrawElement>;
  viewport: ViewportBounds;
  isSelected: boolean;
  isEditing: boolean;
  isFocused: boolean;
  posInSet: number;
  setSize: number;
  level: number;
  treeItemRefs: React.MutableRefObject<Map<string, HTMLDivElement | null>>;
  onKeyDown: (
    e: React.KeyboardEvent<HTMLDivElement>,
    el: ExcalidrawElement,
  ) => void;
  childrenElements: readonly NonDeletedExcalidrawElement[] | null;
  selectedElementIds: AppState["selectedElementIds"];
  editingElementId: string | null;
  focusedElementId: string | null;
};

const MirrorTreeNodeImpl = (props: MirrorTreeNodeProps) => {
  const {
    element,
    elementsById,
    viewport,
    isSelected,
    isEditing,
    isFocused,
    posInSet,
    setSize,
    level,
    treeItemRefs,
    onKeyDown,
    childrenElements,
    selectedElementIds,
    editingElementId,
    focusedElementId,
  } = props;

  // Recompute descriptor on every render of this node. This is cheap
  // (a few t() lookups + arithmetic) and ensures the accessible name
  // tracks the element's current text/position.
  const positionDescriptor = describeElementPosition({
    element,
    viewport,
    elementsById,
  });
  const descriptor = getMirrorDescriptor({
    element,
    positionDescriptor,
    isSelected,
    isEditing,
  });

  const isFrame = childrenElements !== null;

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) {
        treeItemRefs.current.set(element.id, node);
      } else {
        treeItemRefs.current.delete(element.id);
      }
    },
    [element.id, treeItemRefs],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => onKeyDown(e, element),
    [element, onKeyDown],
  );

  // Frames render their treeitem AND a nested role="group" container.
  // The group is the official ARIA pattern for treeitem children
  // (WAI-ARIA 1.2 §6.7).
  return (
    <>
      <div
        ref={setRef}
        role="treeitem"
        aria-label={descriptor.ariaLabel}
        aria-selected={descriptor.ariaState.selected}
        aria-disabled={descriptor.ariaState.disabled || undefined}
        aria-level={level}
        aria-posinset={posInSet}
        aria-setsize={setSize}
        aria-expanded={isFrame ? true : undefined}
        data-element-id={element.id}
        data-editing={descriptor.ariaState.editing || undefined}
        tabIndex={isFocused ? 0 : -1}
        onKeyDown={handleKeyDown}
      >
        {descriptor.textContent ?? ""}
      </div>
      {isFrame && childrenElements && childrenElements.length > 0 && (
        <div role="group" aria-label={descriptor.ariaLabel}>
          {childrenElements.map((child, idx) => (
            <MirrorTreeNode
              key={child.id}
              element={child}
              elementsById={elementsById}
              viewport={viewport}
              isSelected={!!selectedElementIds[child.id]}
              isEditing={editingElementId === child.id}
              isFocused={focusedElementId === child.id}
              posInSet={idx + 1}
              setSize={childrenElements.length}
              level={level + 1}
              treeItemRefs={treeItemRefs}
              onKeyDown={onKeyDown}
              childrenElements={null}
              selectedElementIds={selectedElementIds}
              editingElementId={editingElementId}
              focusedElementId={focusedElementId}
            />
          ))}
        </div>
      )}
    </>
  );
};

// Memo: skip re-render when none of the relevant fields changed.
// Reference equality is enough for primitives (selection bool, focus bool,
// edit bool, position numbers) and for the element object itself, which
// is updated by mutation-via-replacement upstream.
const MirrorTreeNode = React.memo(MirrorTreeNodeImpl);

export const AccessibilityMirror = React.memo(AccessibilityMirrorBase);
