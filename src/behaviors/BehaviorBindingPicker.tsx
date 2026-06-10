import { useCallback, useEffect, useMemo, useState } from "react";

import { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import { BehaviorBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import { BehaviorParametersPicker } from "./BehaviorParametersPicker";
import { LatchConfig, SlotBindingPicker } from "./SlotBindingPicker";
import { formatBinding, validateBinding } from "./parameters";
import { bindingToSlots, buildDerivationRegistry } from "./slots";
import {
  BehaviorTile,
  BindingTileTab,
  isLayerTileable,
  isParameterless,
  isParamTileable,
  isTileable,
  layerTileBindingsFor,
  tileBindingsFor,
} from "./tiles";

export interface BehaviorBindingPickerProps {
  binding: BehaviorBinding;
  behaviors: GetBehaviorDetailsResponse[];
  layers: { id: number; name: string }[];
  onBindingChanged: (binding: BehaviorBinding) => void;
}

// ZMK upstream-shipped behaviors, ordered by how often a typical keymap author
// reaches for them within each group. The first entry of each group is the
// "anchor" behavior (Key Press for typing, Momentary Layer for layers, etc.);
// placeholders (Transparent / None) sit at the end. Step 3a flattens the old
// tier hierarchy into a single row of category tabs and splits the former single
// "System" group into Bluetooth / Output / External Power / System.
const STANDARD_BEHAVIORS: ReadonlyArray<readonly [name: string, group: string]> = [
  // Basic — Sticky Key / Key Toggle (parameterised tiles) lead the Basic-tab
  // column, followed by the parameterless flavor tiles.
  ["Key Press", "Basic"],
  ["Sticky Key", "Basic"],
  ["Key Toggle", "Basic"],
  ["Caps Word", "Basic"],
  ["Key Repeat", "Basic"],
  ["Grave/Escape", "Basic"],
  ["Transparent", "Basic"],
  ["None", "Basic"],
  // Layer
  ["Momentary Layer", "Layer"],
  ["Layer-Tap", "Layer"],
  ["To Layer", "Layer"],
  ["Toggle Layer", "Layer"],
  ["Sticky Layer", "Layer"],
  // Hold-Tap
  ["Mod-Tap", "Hold-Tap"],
  // Mouse
  ["Mouse Key Press", "Mouse"],
  ["Mouse Move", "Mouse"],
  ["Mouse Scroll", "Mouse"],
  ["mouse_move", "Mouse"],
  ["mouse_scroll", "Mouse"],
  // Bluetooth
  ["Bluetooth", "Bluetooth"],
  // Output
  ["Output Selection", "Output"],
  // External Power
  ["External Power", "External Power"],
  // System
  ["Reset", "System"],
  ["Bootloader", "System"],
  ["Studio Unlock", "System"],
];

const STANDARD_BEHAVIOR_GROUPS: Record<string, string> = Object.fromEntries(
  STANDARD_BEHAVIORS.map(([name, group]) => [name, group])
);
const STANDARD_BEHAVIOR_ORDER: Record<string, number> = Object.fromEntries(
  STANDARD_BEHAVIORS.map(([name], i) => [name, i])
);

const GROUP_ORDER = [
  "Basic",
  "Layer",
  "Hold-Tap",
  "Mouse",
  "Bluetooth",
  "Output",
  "External Power",
  "System",
  "Other",
];

// Single-action behaviors are picked the same way a keycode is — as keycap
// tiles in the Normal key grid's tab strip (issue #16, Step 3). Mouse stays its
// own tab; Bluetooth / Output / External Power / System consolidate under one
// "System" tab, inserted between International and Other. A behavior moves onto
// the strip only when it's tile-able (constant / range / nil / no params); the
// rest stay as chips in the residual "More behaviors" area until later steps.
const STRIP_GROUPS: Record<string, "Mouse" | "System"> = {
  Mouse: "Mouse",
  Bluetooth: "System",
  Output: "System",
  "External Power": "System",
  System: "System",
};

// Keycap faces for the in-grid clear tiles: None is left blank (an empty key —
// its tooltip/aria-label still says "None"), the conventional ▽ for Transparent.
// Falls back to the behavior name on its cap.
const CLEAR_TILE_GLYPHS: Record<string, string> = {
  None: "",
  Transparent: "▽",
};

// The flat category a behavior lands in. Standard behaviors use their table
// group; firmware-extension (keymap-author-defined) behaviors classify by shape
// so they land in the same flat tabs (a mouse extension → Mouse, a hold-tap
// shape → Hold-Tap, the rest → Other).
function classifyBehavior(b: GetBehaviorDetailsResponse): string {
  const standard = STANDARD_BEHAVIOR_GROUPS[b.displayName];
  if (standard) return standard;

  if (b.displayName.toLowerCase().includes("mouse")) {
    return "Mouse";
  }
  const set = b.metadata?.[0];
  if (set?.param2?.some((v) => v.hidUsage)) {
    return "Hold-Tap";
  }
  return "Other";
}

// A behavior shown as a keycap tile in the Normal grid's strip (Mouse / System),
// rather than as a chip in the residual area below. Pure (classify + tile shape),
// so it lives at module scope and stays a stable reference for the memos.
function isStripBehavior(b: GetBehaviorDetailsResponse): boolean {
  return isTileable(b) && STRIP_GROUPS[classifyBehavior(b)] !== undefined;
}

export const BehaviorBindingPicker = ({
  binding,
  layers,
  behaviors,
  onBindingChanged,
}: BehaviorBindingPickerProps) => {
  const [behaviorId, setBehaviorId] = useState(binding.behaviorId);
  const [param1, setParam1] = useState<number | undefined>(binding.param1);
  const [param2, setParam2] = useState<number | undefined>(binding.param2);

  const metadata = useMemo(
    () => behaviors.find((b) => b.id == behaviorId)?.metadata,
    [behaviorId, behaviors]
  );

  // Capability-aware id lookups for the persistent clear tiles. Matching by
  // displayName mirrors how the rest of the picker classifies behaviors; a tile
  // only renders when the connected firmware actually exposes that behavior.
  const keyPressId = useMemo(
    () => behaviors.find((b) => b.displayName === "Key Press")?.id,
    [behaviors]
  );
  const clearBehaviors = useMemo(
    () =>
      ["None", "Transparent"]
        .map((name) => behaviors.find((b) => b.displayName === name))
        .filter((b): b is GetBehaviorDetailsResponse => !!b),
    [behaviors]
  );

  // Slot model (Step 2): the four core behaviors are edited through the Normal /
  // Hold mode slot surface and derived from it, so their chips are hidden — the
  // surface owns them, avoiding a two-ways-to-edit-one-binding sync hazard.
  const registry = useMemo(() => buildDerivationRegistry(behaviors), [behaviors]);
  const derivedChipIds = useMemo(
    () =>
      new Set(
        (["kp", "mt", "lt", "mo"] as const)
          .map((core) => registry.idByCore[core])
          .filter((id): id is number => id !== undefined)
      ),
    [registry]
  );

  const sortedBehaviors = useMemo(
    () =>
      behaviors.slice().sort((a, b) => {
        const ai = STANDARD_BEHAVIOR_ORDER[a.displayName];
        const bi = STANDARD_BEHAVIOR_ORDER[b.displayName];
        if (ai !== undefined && bi !== undefined) return ai - bi;
        if (ai !== undefined) return -1;
        if (bi !== undefined) return 1;
        return a.displayName.localeCompare(b.displayName);
      }),
    [behaviors]
  );

  // Behaviors edited on the slot surface are hidden from the residual area: the
  // four cores (via derivedChipIds), the clear tiles, and now any custom hold-tap
  // — the `&mt` shape (mod-tap family) and the `&lt` shape (layer-tap family) —
  // routed into Hold mode with an identity choice (issue #16 §8 Q2). `&mt`/`&lt`
  // themselves are already cores.
  const hiddenIds = useMemo(
    () =>
      new Set([
        ...clearBehaviors.map((b) => b.id),
        ...derivedChipIds,
        ...registry.modTapIds,
        ...registry.layerTapIds,
      ]),
    [clearBehaviors, derivedChipIds, registry]
  );

  // The "flavor" behaviors leave the residual chip area (issue #16). They split
  // by shape: the single-key ones (Sticky Key / Key Toggle) are key-state latches
  // on the slot surface (isBasicWrapper); the parameterless ones are one-tap
  // tiles (isSpecialTile). (Key Press also has the single-key shape but is a
  // hidden core behavior, so hiddenIds already excludes it.) Both are memoized so
  // they're stable deps for the grouping memos below — only changing with
  // hiddenIds — keeping react-hooks/exhaustive-deps satisfied.
  //
  // isSpecialTile: a *recognized standard* parameterless flavor behavior (Caps
  // Word / Key Repeat / Grave-Escape — the Basic group). They render in the
  // Apps/Media/Special tab. Custom (unrecognized) behaviors don't land here even
  // when parameterless — they go to the Custom tab (isCustomTileBehavior), so
  // "Special" stays the curated standard set and "Custom" holds your own.
  const isSpecialTile = useCallback(
    (b: GetBehaviorDetailsResponse) =>
      classifyBehavior(b) === "Basic" &&
      !hiddenIds.has(b.id) &&
      isParameterless(b),
    [hiddenIds]
  );
  const isBasicWrapper = useCallback(
    (b: GetBehaviorDetailsResponse) =>
      classifyBehavior(b) === "Basic" &&
      !hiddenIds.has(b.id) &&
      !isTileable(b) &&
      isParamTileable(b),
    [hiddenIds]
  );

  // Persistent layer switches (To / Toggle / Sticky Layer) move from the residual
  // chips onto the Normal grid's "Layer" tab as per-layer tiles (issue #16,
  // Step 4). Momentary Layer / Layer-Tap share the layer-param shape but are
  // slot-model cores, so hiddenIds already excludes them.
  const isLayerTabBehavior = useCallback(
    (b: GetBehaviorDetailsResponse) =>
      classifyBehavior(b) === "Layer" &&
      !hiddenIds.has(b.id) &&
      isLayerTileable(b),
    [hiddenIds]
  );

  // A custom (firmware-extension) tile-able behavior that we don't recognize as a
  // standard — classified "Other" (not a standard group, not a mouse/hold-tap
  // shape). Covers both a parameterless custom (e.g. Num Word) and a custom enum/
  // range (e.g. an LED-mode selector): all of *your* tile-able behaviors gather in
  // one "Custom" tab in the Normal grid's strip, rather than the residual area
  // (issue #16 — draining the residual escape hatch). Hold-tap-shaped customs go
  // to Hold mode instead (by interaction shape), so they're not here.
  const isCustomTileBehavior = useCallback(
    (b: GetBehaviorDetailsResponse) =>
      classifyBehavior(b) === "Other" &&
      !hiddenIds.has(b.id) &&
      isTileable(b),
    [hiddenIds]
  );

  // Flat category map for the residual "More behaviors" area. None / Transparent
  // surface as keycap tiles in the key grid, the four core behaviors live on the
  // slot surface, and the single-action tile behaviors moved into the Normal
  // strip — so drop all of those here.
  const groupedBehaviors = useMemo(() => {
    const out: Record<string, GetBehaviorDetailsResponse[]> = {};
    for (const b of sortedBehaviors) {
      if (hiddenIds.has(b.id)) continue;
      if (isStripBehavior(b)) continue;
      if (
        isSpecialTile(b) ||
        isBasicWrapper(b) ||
        isLayerTabBehavior(b) ||
        isCustomTileBehavior(b)
      )
        continue;
      const group = classifyBehavior(b);
      if (!out[group]) out[group] = [];
      out[group].push(b);
    }
    return out;
  }, [
    sortedBehaviors,
    hiddenIds,
    isSpecialTile,
    isBasicWrapper,
    isLayerTabBehavior,
    isCustomTileBehavior,
  ]);

  // The slot surface offers one generic "Sticky / Toggle" latch that maps to the
  // key family (&sk / &kt over a base &kp) or the layer family (&sl / &tog over a
  // base &to) depending on the current binding. Resolve each behavior id by
  // displayName (capability-aware — undefined when the firmware omits it).
  const behaviorIdByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of behaviors) m.set(b.displayName, b.id);
    return m;
  }, [behaviors]);
  const keyLatch = useMemo<LatchConfig>(
    () => ({
      base: registry.idByCore.kp,
      sticky: behaviorIdByName.get("Sticky Key"),
      toggle: behaviorIdByName.get("Key Toggle"),
    }),
    [registry, behaviorIdByName]
  );
  const layerLatch = useMemo<LatchConfig>(
    () => ({
      base: behaviorIdByName.get("To Layer"),
      sticky: behaviorIdByName.get("Sticky Layer"),
      toggle: behaviorIdByName.get("Toggle Layer"),
    }),
    [behaviorIdByName]
  );

  // The hold-tap identity choices for the Hold-mode surface: the standard `&mt` /
  // `&lt` plus any custom hold-taps of the same shape (issue #16 §8 Q2). The slot
  // surface shows a selector only when a family has more than one.
  const nameById = useCallback(
    (id: number) => behaviors.find((b) => b.id === id)?.displayName ?? "",
    [behaviors]
  );
  const modTapOptions = useMemo(
    () => registry.modTapIds.map((id) => ({ id, name: nameById(id) })),
    [registry, nameById]
  );
  const layerTapOptions = useMemo(
    () => registry.layerTapIds.map((id) => ({ id, name: nameById(id) })),
    [registry, nameById]
  );

  // The whole-binding behavior tabs for the Normal strip: a Layer tab (To Layer,
  // one tile per layer — Sticky / Toggle Layer are applied via the latch, not as
  // tiles), then Mouse, then a consolidated System (Bluetooth / Output / External
  // Power / System), each a run of labelled keycap-tile sections.
  const behaviorTabs = useMemo<BindingTileTab[]>(() => {
    const sections: Record<"Mouse" | "System", BindingTileTab["sections"]> = {
      Mouse: [],
      System: [],
    };
    for (const b of sortedBehaviors) {
      if (hiddenIds.has(b.id) || !isStripBehavior(b)) continue;
      const tab = STRIP_GROUPS[classifyBehavior(b)];
      sections[tab].push({
        heading: b.displayName,
        tiles: tileBindingsFor(b) ?? [],
      });
    }
    const tabs: BindingTileTab[] = [];
    // Layer tab: the To Layer base, exploded per layer. matchFamily lets &sl /
    // &tog (same layer family) highlight their layer's tile and jump here too.
    const toLayer = sortedBehaviors.find(
      (b) => !hiddenIds.has(b.id) && b.displayName === "To Layer"
    );
    if (toLayer) {
      const matchFamily = [layerLatch.base, layerLatch.sticky, layerLatch.toggle].filter(
        (x): x is number => x !== undefined
      );
      tabs.push({
        name: "Layer",
        // No section heading: the latch (Sticky / Toggle), not a label, decides
        // To / Sticky / Toggle, so "To Layer" would misread as the only option.
        sections: [{ tiles: layerTileBindingsFor(toLayer, layers) ?? [] }],
        matchFamily,
      });
    }
    if (sections.Mouse.length) tabs.push({ name: "Mouse", sections: sections.Mouse });
    if (sections.System.length)
      tabs.push({ name: "System", sections: sections.System });
    // Custom tab: firmware-extension enum/range behaviors that fit no known strip
    // group, one labelled section each — so they leave the residual area too.
    const custom = sortedBehaviors
      .filter(isCustomTileBehavior)
      .map((b) => ({ heading: b.displayName, tiles: tileBindingsFor(b) ?? [] }));
    if (custom.length) tabs.push({ name: "Custom", sections: custom });
    return tabs;
  }, [sortedBehaviors, hiddenIds, layers, layerLatch, isCustomTileBehavior]);

  // The rarely-used one-tap flavor tiles (Caps Word / Key Repeat / Grave-Escape),
  // one finished binding each, appended into the Apps/Media/Special tab.
  // Capability-aware — only firmware-exposed ones.
  const specialTiles = useMemo<BehaviorTile[]>(() => {
    const out: BehaviorTile[] = [];
    for (const b of sortedBehaviors) {
      if (isSpecialTile(b)) out.push(...(tileBindingsFor(b) ?? []));
    }
    return out;
  }, [sortedBehaviors, isSpecialTile]);

  const currentBehavior = behaviors.find((b) => b.id === behaviorId);
  const currentGroup = currentBehavior
    ? classifyBehavior(currentBehavior)
    : null;

  const [activeGroup, setActiveGroup] = useState<string>(
    currentGroup ?? "Basic"
  );

  // When the bound behavior changes (e.g. user clicked a different key on the
  // keyboard image), jump the picker to the matching category. Intentionally
  // keyed on behaviorId only — we don't want to re-jump when currentGroup
  // recomputes for the same behavior.
  useEffect(() => {
    if (currentGroup) setActiveGroup(currentGroup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [behaviorId]);

  const availableGroups = GROUP_ORDER.filter(
    (g) => groupedBehaviors[g]?.length
  );
  const effectiveGroup = availableGroups.includes(activeGroup)
    ? activeGroup
    : availableGroups[0];

  const selectBehavior = (id: number) => {
    if (id !== behaviorId) {
      setBehaviorId(id);
      setParam1(0);
      setParam2(0);
    }
  };

  // A tile encodes a finished binding (behaviorId + both params), so picking one
  // sets all three at once — no parameter panel needed.
  const selectTile = (b: BehaviorBinding) => {
    setBehaviorId(b.behaviorId);
    setParam1(b.param1);
    setParam2(b.param2);
  };

  // Shared look for the selectable behavior chips, so a future style tweak
  // stays consistent across the picker.
  const chipClass = (selected: boolean) =>
    `px-3 py-1 rounded border text-sm ${
      selected
        ? "bg-primary text-primary-content border-primary"
        : "bg-base-200 hover:bg-base-300 border-base-300"
    }`;

  // Keycap-styled so picking a behavior tile reads like picking a key — same
  // height + font as the Normal grid's keycode/behavior tiles.
  const tileClass = (selected: boolean) =>
    `min-w-16 h-16 px-2 rounded border whitespace-nowrap leading-tight flex items-center justify-center text-center ${
      selected
        ? "bg-primary text-primary-content border-primary"
        : "bg-base-200 hover:bg-base-300 border-base-300"
    }`;

  const renderBehaviorChip = (b: GetBehaviorDetailsResponse) => {
    const selected = b.id === behaviorId;
    return (
      <button
        key={b.id}
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={() => selectBehavior(b.id)}
        className={chipClass(selected)}
      >
        {b.displayName}
      </button>
    );
  };

  useEffect(() => {
    if (
      binding.behaviorId === behaviorId &&
      binding.param1 === param1 &&
      binding.param2 === param2
    ) {
      return;
    }

    if (!metadata) {
      console.error(
        "Can't find metadata for the selected behaviorId",
        behaviorId
      );
      return;
    }

    if (
      validateBinding(
        metadata,
        layers.map(({ id }) => id),
        param1,
        param2
      )
    ) {
      onBindingChanged({
        behaviorId,
        param1: param1 || 0,
        param2: param2 || 0,
      });
    }
    // Fires only when the local edit state changes; metadata/layers/callbacks
    // are read fresh but must not re-trigger the write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [behaviorId, param1, param2]);

  useEffect(() => {
    setBehaviorId(binding.behaviorId);
    setParam1(binding.param1);
    setParam2(binding.param2);
  }, [binding]);

  const isClearBehavior = clearBehaviors.some((b) => b.id === behaviorId);
  // Only offer the live keycode grid (instead of the dimmed placeholder) while
  // a clear tile is active, and only if Key Press exists to promote to.
  const promoteToKeyPress =
    keyPressId !== undefined && isClearBehavior
      ? (usage?: number) => {
          if (usage === undefined) return;
          setBehaviorId(keyPressId);
          setParam1(usage);
          setParam2(0);
        }
      : undefined;

  // Persistent None / Transparent tiles rendered inside every key-grid tab (see
  // HidUsagePicker). activeId highlights whichever is the current behavior.
  const clearTiles =
    clearBehaviors.length > 0
      ? {
          tiles: clearBehaviors.map((b) => ({
            id: b.id,
            label: b.displayName,
            glyph: CLEAR_TILE_GLYPHS[b.displayName] ?? b.displayName,
          })),
          activeId: behaviorId,
          onSelect: selectBehavior,
        }
      : undefined;

  // The slot surface edits the same local behaviorId/param1/param2 the chips do,
  // so there's a single source of truth and no chip<->slot sync to maintain.
  const currentBinding: BehaviorBinding = {
    behaviorId,
    param1: param1 ?? 0,
    param2: param2 ?? 0,
  };
  const isCoreBinding = bindingToSlots(currentBinding, registry) !== null;
  // A tile behavior (single-action / enum) bakes its params into the tile, so it
  // doesn't get the parameter panel either — its active tile shows the state.
  const isTileBinding = currentBehavior ? isTileable(currentBehavior) : false;
  // A param-tile behavior (Sticky Key / Key Toggle) picks its key in-panel on the
  // slot surface, so it skips the far-bottom params picker too. Key Press shares
  // the single-HID-key shape but is a *core* behavior (edited via the slots), so
  // gate on !isCoreBinding to keep it out of the param-tile path.
  const isParamTileBinding =
    currentBehavior && !isCoreBinding
      ? isParamTileable(currentBehavior)
      : false;
  const setBindingFromSlots = (b: BehaviorBinding) => {
    setBehaviorId(b.behaviorId);
    setParam1(b.param1);
    setParam2(b.param2);
  };

  const groupBehaviors = groupedBehaviors[effectiveGroup] ?? [];
  const tileBehaviors = groupBehaviors.filter(isTileable);
  const chipBehaviors = groupBehaviors.filter((b) => !isTileable(b));

  const tileActive = (b: BehaviorBinding) =>
    b.behaviorId === behaviorId &&
    b.param1 === (param1 ?? 0) &&
    b.param2 === (param2 ?? 0);

  return (
    <div className="flex flex-col gap-3">
      <SlotBindingPicker
        binding={currentBinding}
        registry={registry}
        layers={layers}
        onBindingChanged={setBindingFromSlots}
        clearTiles={clearTiles}
        behaviorTabs={behaviorTabs}
        specialTiles={specialTiles}
        keyLatch={keyLatch}
        layerLatch={layerLatch}
        modTapOptions={modTapOptions}
        layerTapOptions={layerTapOptions}
        currentBehaviorName={currentBehavior?.displayName}
        bindingCode={formatBinding(
          currentBinding,
          currentBehavior,
          layers.map((l) => l.id)
        )}
      />
      {/* Residual area for behaviors not yet migrated onto the slot surface or
          the Normal grid's tabs (persistent layers, custom hold-taps, ...). It
          disappears entirely once nothing's left to show. */}
      {availableGroups.length > 0 && (
      <div className="flex flex-col gap-2 border-t pt-2">
        <label className="text-sm uppercase tracking-widest font-bold text-primary">
          More behaviors
        </label>
        <p className="text-xs text-base-content/60">
          Pick a tile for a finished binding, or a behavior to set its
          parameters. Typing, basic and hold-tap keys live on the slot surface
          above.
        </p>
        <div
          role="tablist"
          aria-label="Behavior category"
          className="flex flex-wrap gap-1 border-b"
        >
          {availableGroups.map((g) => {
            const isActive = effectiveGroup === g;
            return (
              <button
                key={g}
                role="tab"
                type="button"
                aria-selected={isActive}
                onClick={() => setActiveGroup(g)}
                className={`px-3 py-1 text-sm ${
                  isActive
                    ? "border-b-2 border-primary text-primary font-medium"
                    : "text-base-content/70 hover:text-base-content border-b-2 border-transparent"
                }`}
              >
                {g}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-3 pt-1">
          {/* Tile-able behaviors: a labelled grid per behavior, one tile per
              finished binding. The per-behavior heading disambiguates shared
              value names (e.g. Mouse Move "Up" vs Mouse Scroll "Up"). */}
          {tileBehaviors.map((b) => {
            const tiles = tileBindingsFor(b) ?? [];
            return (
              <div key={b.id} className="flex flex-col gap-1">
                <span className="text-sm uppercase tracking-wide font-semibold text-base-content/70">
                  {b.displayName}
                </span>
                <div
                  role="radiogroup"
                  aria-label={b.displayName}
                  className="flex flex-wrap gap-1"
                >
                  {tiles.map((tile) => {
                    const selected = tileActive(tile.binding);
                    return (
                      <button
                        key={`${tile.binding.behaviorId}-${tile.binding.param1}-${tile.binding.param2}`}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => selectTile(tile.binding)}
                        className={tileClass(selected)}
                      >
                        {tile.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Non-tile-able behaviors (persistent layers, custom hold-taps):
              pick a chip, then set its parameters below. */}
          {chipBehaviors.length > 0 && (
            <div
              role="radiogroup"
              aria-label="Behavior"
              className="flex flex-wrap gap-1"
            >
              {chipBehaviors.map(renderBehaviorChip)}
            </div>
          )}
        </div>
      </div>
      )}
      {/* Core behaviors are edited on the slot surface above, tile behaviors bake
          their params into the tile, and param-tile behaviors (Sticky Key / Key
          Toggle) pick their key in-panel; only the remaining non-core behaviors
          (persistent layers, custom hold-taps, ...) keep the params picker. */}
      {metadata && !isCoreBinding && !isTileBinding && !isParamTileBinding && (
        <BehaviorParametersPicker
          metadata={metadata}
          param1={param1}
          param2={param2}
          layers={layers}
          onParam1Changed={setParam1}
          onParam2Changed={setParam2}
          onPromoteToKeyPress={promoteToKeyPress}
          clearTiles={clearTiles}
        />
      )}
    </div>
  );
};
