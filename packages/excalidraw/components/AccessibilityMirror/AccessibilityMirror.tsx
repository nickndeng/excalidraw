import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { t, getLanguage } from "../../i18n";
import { KEYS } from "../../keys";
import { getCommonBounds } from "../../element/bounds";
import { isFrameLikeElement, isTextElement } from "../../element/typeChecks";
import { makeNextSelectedElementIds } from "../../scene/selection";
import { actionDeleteSelected } from "../../actions/actionDeleteSelected";

import { buildMirrorModel, buildSpatialItems } from "../../a11y/mirrorModel";
import { findSpatialNeighbor } from "../../a11y/spatialNavigation";
import {
  getElementMirrorRole,
  getElementAccessibleName,
  getElementAriaState,
} from "../../a11y/ariaRoles";

import "./AccessibilityMirror.scss";

import type { MirrorNode } from "../../a11y/mirrorModel";
import type { Direction } from "../../a11y/spatialNavigation";
import type { Bounds } from "../../element/bounds";
import type {
  ElementsMap,
  NonDeletedExcalidrawElement,
} from "../../element/types";
import type { AppState } from "../../types";
import type App from "../App";

/**
 * The imperative handle the mirror registers on the App instance so that the
 * single canvas keyboard pipeline (`App.onKeyDown`) can delegate to it. The
 * mirror never installs its own global key listener — there is one keymap.
 */
export type AccessibilityMirrorHandle = {
  /** returns true if the mirror consumed the event */
  handleKeyDown: (event: React.KeyboardEvent | KeyboardEvent) => boolean;
};

type AccessibilityMirrorProps = {
  app: App;
  elements: readonly NonDeletedExcalidrawElement[];
  elementsMap: ElementsMap;
  appState: AppState;
};

// instance-unique id seed. Deliberately NOT React.useId(), so the mirror does
// not consume the global useId counter and shift ids in unrelated components
// (e.g. radix popovers) — which would break their DOM snapshots.
let a11yInstanceCounter = 0;

const ARROW_DIRECTION: Record<string, Direction> = {
  [KEYS.ARROW_LEFT]: "left",
  [KEYS.ARROW_RIGHT]: "right",
  [KEYS.ARROW_UP]: "up",
  [KEYS.ARROW_DOWN]: "down",
};

type MirrorOptionProps = {
  id: string;
  role: string;
  name: string;
  selected: boolean;
  disabled: boolean;
  editing: boolean;
  editingDescId: string;
  onOptionFocus: (id: string) => void;
};

/**
 * A single focusable mirror node. Memoized on primitive props so unchanged
 * nodes are never re-rendered during incremental scene updates.
 */
const MirrorOption = memo((props: MirrorOptionProps) => {
  const { id, role, name, selected, disabled, editing, editingDescId } = props;
  return (
    <div
      role={role}
      data-element-id={id}
      tabIndex={0}
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      aria-describedby={editing ? editingDescId : undefined}
      onFocus={() => props.onOptionFocus(id)}
    >
      {name}
    </div>
  );
});
MirrorOption.displayName = "MirrorOption";

export const AccessibilityMirror = (props: AccessibilityMirrorProps) => {
  const { app, elements, elementsMap, appState } = props;

  const isRTL = !!getLanguage().rtl;

  const containerRef = useRef<HTMLDivElement>(null);
  const [idBase] = useState(
    () => `excalidraw-a11y-mirror-${(a11yInstanceCounter++).toString(36)}`,
  );
  const instructionsId = `${idBase}-hint`;
  const editingDescId = `${idBase}-editing`;

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState("");

  // refs read from the (stable) keyboard handler and effects
  const focusedIdRef = useRef<string | null>(null);
  const elementsRef = useRef(elements);
  const elementsMapRef = useRef(elementsMap);
  const appStateRef = useRef(appState);
  const pendingDomFocusRef = useRef(false);
  const mirrorDrivenSelectionRef = useRef(false);
  const suppressSelectionAnnounceRef = useRef(false);
  const announceToggleRef = useRef(false);
  const prevSelectionKeyRef = useRef<string | null>(null);
  const prevEditingIdRef = useRef<string | null>(null);
  const prevEditingNameRef = useRef<string>("");

  useEffect(() => {
    focusedIdRef.current = focusedId;
  }, [focusedId]);
  elementsRef.current = elements;
  elementsMapRef.current = elementsMap;
  appStateRef.current = appState;

  const sceneBounds = useMemo<Bounds>(() => {
    if (elements.length === 0) {
      return [0, 0, 0, 0];
    }
    return getCommonBounds(elements, elementsMap);
  }, [elements, elementsMap]);

  const viewportBounds = useMemo<Bounds>(() => {
    const { scrollX, scrollY, zoom, width, height } = appState;
    return [
      -scrollX,
      -scrollY,
      -scrollX + width / zoom.value,
      -scrollY + height / zoom.value,
    ];
  }, [
    appState.scrollX,
    appState.scrollY,
    appState.zoom.value,
    appState.width,
    appState.height,
  ]);

  const selectionKey = useMemo(
    () =>
      Object.keys(appState.selectedElementIds)
        .filter((id) => appState.selectedElementIds[id])
        .sort()
        .join(","),
    [appState.selectedElementIds],
  );

  const model = useMemo(
    () =>
      buildMirrorModel({
        elements,
        elementsMap,
        selectedElementIds: appState.selectedElementIds,
        focusedElementId: focusedId,
        viewportBounds,
      }),
    // selectionKey/viewportBounds capture the relevant appState slices
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [elements, elementsMap, selectionKey, focusedId, viewportBounds],
  );

  const accessibleName = useCallback(
    (id: string): string => {
      const element = elementsMap.get(id);
      if (!element) {
        return "";
      }
      const frameElement = element.frameId
        ? elementsMap.get(element.frameId)
        : null;
      const frame =
        frameElement && isFrameLikeElement(frameElement) ? frameElement : null;
      return getElementAccessibleName({
        element,
        elementsMap,
        frame,
        sceneBounds,
        isRTL,
        t,
      });
    },
    [elementsMap, sceneBounds, isRTL],
  );
  const accessibleNameRef = useRef(accessibleName);
  accessibleNameRef.current = accessibleName;

  const announce = useCallback((message: string) => {
    // toggle a trailing zero-width space so identical consecutive messages are
    // still re-announced by screen readers
    announceToggleRef.current = !announceToggleRef.current;
    setLiveMessage(announceToggleRef.current ? message : `${message}​`);
  }, []);

  const mirrorHasFocus = useCallback(
    () => !!containerRef.current?.contains(document.activeElement),
    [],
  );

  const moveFocusTo = useCallback((id: string) => {
    focusedIdRef.current = id;
    pendingDomFocusRef.current = true;
    setFocusedId(id);
  }, []);

  // apply DOM focus after the focused node has (re)mounted
  useLayoutEffect(() => {
    if (pendingDomFocusRef.current && focusedId) {
      const node = containerRef.current?.querySelector<HTMLElement>(
        `[data-element-id="${focusedId}"]`,
      );
      node?.focus();
      pendingDomFocusRef.current = false;
    }
  }, [focusedId, model]);

  // --- selection coherence + announcements -------------------------------
  useEffect(() => {
    if (prevSelectionKeyRef.current === null) {
      // don't announce/refocus for the initial selection state
      prevSelectionKeyRef.current = selectionKey;
      return;
    }
    if (prevSelectionKeyRef.current === selectionKey) {
      return;
    }
    prevSelectionKeyRef.current = selectionKey;

    const selectedIds = selectionKey ? selectionKey.split(",") : [];

    // canvas-driven selection moves the mirror's focus pointer to the first
    // selected element (only stealing DOM focus if the mirror already has it)
    if (!mirrorDrivenSelectionRef.current && selectedIds.length > 0) {
      const target = selectedIds[0];
      if (mirrorHasFocus()) {
        moveFocusTo(target);
      } else {
        focusedIdRef.current = target;
        setFocusedId(target);
      }
    }

    if (suppressSelectionAnnounceRef.current) {
      suppressSelectionAnnounceRef.current = false;
    } else if (selectedIds.length === 0) {
      announce(t("a11y.announce.selectionCleared"));
    } else if (selectedIds.length === 1) {
      announce(
        t("a11y.announce.selected", {
          name: accessibleNameRef.current(selectedIds[0]),
        }),
      );
    } else {
      announce(t("a11y.announce.multiSelected", { count: selectedIds.length }));
    }

    mirrorDrivenSelectionRef.current = false;
  }, [selectionKey, announce, mirrorHasFocus, moveFocusTo]);

  // --- text-edit announcements (covers F2 and canvas double-click) -------
  const editingId = appState.editingTextElement?.id ?? null;
  useEffect(() => {
    const prev = prevEditingIdRef.current;
    if (editingId && editingId !== prev) {
      const editingElement = appStateRef.current.editingTextElement;
      const targetId =
        (editingElement &&
          isTextElement(editingElement) &&
          editingElement.containerId) ||
        editingId;
      const name = accessibleNameRef.current(targetId);
      prevEditingNameRef.current = name;
      announce(t("a11y.announce.editingStarted", { name }));
    } else if (!editingId && prev) {
      announce(
        t("a11y.announce.editingFinished", {
          name: prevEditingNameRef.current,
        }),
      );
    }
    prevEditingIdRef.current = editingId;
  }, [editingId, announce]);

  // --- selection mutation helpers (single source of truth: appState) -----
  const applySelection = useCallback(
    (nextSelectedElementIds: AppState["selectedElementIds"]) => {
      mirrorDrivenSelectionRef.current = true;
      app.setState((prev) => ({
        selectedElementIds: makeNextSelectedElementIds(
          nextSelectedElementIds,
          prev,
        ),
        selectedGroupIds: {},
      }));
    },
    [app],
  );

  const toggleSelection = useCallback(
    (id: string, additive: boolean) => {
      const current = appStateRef.current.selectedElementIds;
      let next: { [id: string]: true };
      if (additive) {
        next = { ...current };
        if (next[id]) {
          delete next[id];
        } else {
          next[id] = true;
        }
      } else {
        const isSoleSelection =
          current[id] && Object.keys(current).length === 1;
        next = isSoleSelection ? {} : { [id]: true };
      }
      applySelection(next);
    },
    [applySelection],
  );

  // --- the single delegated keyboard handler -----------------------------
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent | KeyboardEvent): boolean => {
      const container = containerRef.current;
      if (!container || !container.contains(document.activeElement)) {
        // focus is on the canvas (or elsewhere) — let the normal pipeline run
        return false;
      }

      const focused = focusedIdRef.current;
      const key = event.key;

      // spatial navigation
      if (key in ARROW_DIRECTION) {
        event.preventDefault();
        if (focused) {
          const items = buildSpatialItems(
            elementsRef.current,
            elementsMapRef.current,
          );
          const next = findSpatialNeighbor(
            items,
            focused,
            ARROW_DIRECTION[key],
            {
              isRTL,
            },
          );
          if (next) {
            moveFocusTo(next);
          }
        }
        return true;
      }

      if (key === KEYS.ENTER) {
        if (!focused) {
          return false;
        }
        event.preventDefault();
        toggleSelection(focused, event.shiftKey);
        return true;
      }

      if (key === "F2") {
        if (!focused) {
          return false;
        }
        event.preventDefault();
        applySelection({ [focused]: true });
        app.startTextEditingViaA11y(focused);
        return true;
      }

      if (key === KEYS.DELETE || key === KEYS.BACKSPACE) {
        const current = appStateRef.current.selectedElementIds;
        const selectedIds = Object.keys(current).filter((id) => current[id]);
        if (selectedIds.length === 0) {
          return false;
        }
        event.preventDefault();

        // choose a focus target that survives the deletion
        const order = model.order;
        const selectedSet = new Set(selectedIds);
        const focusIndex = focused ? order.indexOf(focused) : -1;
        let focusAfter: string | null = null;
        for (
          let offset = 1;
          offset < order.length && focusIndex !== -1;
          offset++
        ) {
          const after = order[focusIndex + offset];
          const before = order[focusIndex - offset];
          if (after && !selectedSet.has(after)) {
            focusAfter = after;
            break;
          }
          if (before && !selectedSet.has(before)) {
            focusAfter = before;
            break;
          }
        }

        const names = selectedIds.map((id) => accessibleNameRef.current(id));

        // route the actual deletion through the existing action
        suppressSelectionAnnounceRef.current = true;
        app.actionManager.executeAction(actionDeleteSelected);

        announce(
          selectedIds.length === 1
            ? t("a11y.announce.deleted", { name: names[0] })
            : t("a11y.announce.deletedMultiple", { count: selectedIds.length }),
        );

        if (focusAfter) {
          moveFocusTo(focusAfter);
        } else {
          setFocusedId(null);
          focusedIdRef.current = null;
          app.focusContainer();
        }
        return true;
      }

      if (key === KEYS.ESCAPE) {
        event.preventDefault();
        applySelection({});
        setFocusedId(null);
        focusedIdRef.current = null;
        app.focusContainer();
        return true;
      }

      // everything else (undo/redo, select-all, …) falls through to the
      // existing canvas keyboard handler
      return false;
    },
    [app, isRTL, model, moveFocusTo, toggleSelection, applySelection, announce],
  );

  // register/unregister the handle on the App instance
  const handleKeyDownRef = useRef(handleKeyDown);
  handleKeyDownRef.current = handleKeyDown;
  useEffect(() => {
    const handle: AccessibilityMirrorHandle = {
      handleKeyDown: (event) => handleKeyDownRef.current(event),
    };
    app.registerAccessibilityMirror(handle);
    return () => app.unregisterAccessibilityMirror(handle);
  }, [app]);

  const handleOptionFocus = useCallback((id: string) => {
    focusedIdRef.current = id;
    setFocusedId(id);
  }, []);

  const { mounted } = model;

  const renderOption = (element: NonDeletedExcalidrawElement) => {
    if (!mounted.has(element.id)) {
      return null;
    }
    const frameElement = element.frameId
      ? elementsMap.get(element.frameId)
      : null;
    const frame =
      frameElement && isFrameLikeElement(frameElement) ? frameElement : null;
    const state = getElementAriaState(element, appState);
    return (
      <MirrorOption
        key={element.id}
        id={element.id}
        role={getElementMirrorRole(element)}
        name={getElementAccessibleName({
          element,
          elementsMap,
          frame,
          sceneBounds,
          isRTL,
          t,
        })}
        selected={state.selected}
        disabled={state.disabled}
        editing={state.editing}
        editingDescId={editingDescId}
        onOptionFocus={handleOptionFocus}
      />
    );
  };

  const renderNode = (node: MirrorNode): React.ReactNode => {
    if (node.isFrame) {
      if (!mounted.has(node.id)) {
        return null;
      }
      return (
        <div key={node.id} role="group" aria-label={accessibleName(node.id)}>
          {node.children.map((child) => renderOption(child.element))}
        </div>
      );
    }
    return renderOption(node.element);
  };

  return (
    <>
      <div
        ref={containerRef}
        className="excalidraw__a11y-mirror"
        role="listbox"
        aria-multiselectable="true"
        aria-label={t("a11y.canvas.label")}
        aria-describedby={instructionsId}
      >
        <span id={instructionsId} className="excalidraw__a11y-mirror__hint">
          {t("a11y.canvas.description")}
        </span>
        <span id={editingDescId} className="excalidraw__a11y-mirror__hint">
          {t("a11y.state.editing")}
        </span>
        {model.tree.map(renderNode)}
      </div>
      <div
        className="excalidraw__a11y-live"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {liveMessage}
      </div>
    </>
  );
};

AccessibilityMirror.displayName = "AccessibilityMirror";
