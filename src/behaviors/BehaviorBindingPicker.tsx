import { useEffect, useMemo, useState } from "react";

import { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import { BehaviorBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import { BehaviorParametersPicker } from "./BehaviorParametersPicker";
import { SlotBindingPicker } from "./SlotBindingPicker";
import { validateBinding } from "./parameters";
import { bindingToSlots, buildDerivationRegistry } from "./slots";

export interface BehaviorBindingPickerProps {
  binding: BehaviorBinding;
  behaviors: GetBehaviorDetailsResponse[];
  layers: { id: number; name: string }[];
  onBindingChanged: (binding: BehaviorBinding) => void;
}

// ZMK upstream-shipped behaviors, ordered by how often a typical keymap author
// reaches for them within each group. The first entry of each group is the
// "anchor" behavior (Key Press for typing, Momentary Layer for layers, etc.);
// placeholders (Transparent / None) sit at the end.
const STANDARD_BEHAVIORS: ReadonlyArray<readonly [name: string, group: string]> = [
  // Basic
  ["Key Press", "Basic"],
  ["Sticky Key", "Basic"],
  ["Caps Word", "Basic"],
  ["Key Repeat", "Basic"],
  ["Key Toggle", "Basic"],
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
  // System
  ["Bluetooth", "System"],
  ["Output Selection", "System"],
  ["External Power", "System"],
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

const GROUP_ORDER = ["Basic", "Layer", "Hold-Tap", "Mouse", "System", "Other"];

// Keycap faces for the in-grid clear tiles: None is left blank (an empty key —
// its tooltip/aria-label still says "None"), the conventional ▽ for Transparent.
// Falls back to the behavior name on its cap.
const CLEAR_TILE_GLYPHS: Record<string, string> = {
  None: "",
  Transparent: "▽",
};

interface BehaviorClass {
  tier: "standard" | "extension";
  group: string;
}

function classifyBehavior(b: GetBehaviorDetailsResponse): BehaviorClass {
  const standard = STANDARD_BEHAVIOR_GROUPS[b.displayName];
  if (standard) return { tier: "standard", group: standard };

  // Firmware-extension (keymap-author-defined) behaviors: classify by shape.
  if (b.displayName.toLowerCase().includes("mouse")) {
    return { tier: "extension", group: "Mouse" };
  }
  const set = b.metadata?.[0];
  if (set?.param2?.some((v) => v.hidUsage)) {
    return { tier: "extension", group: "Hold-Tap" };
  }
  return { tier: "extension", group: "Other" };
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

  // Slot model (Step 2): the four core behaviors are edited through the Tap /
  // Hold slot surface and derived from it, so their chips are hidden — the
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

  const tieredBehaviors = useMemo(() => {
    // None / Transparent are surfaced as keycap tiles in the key grid, and the
    // four core behaviors live on the slot surface, so drop all of their
    // redundant chips from the behavior groups.
    const hiddenIds = new Set([
      ...clearBehaviors.map((b) => b.id),
      ...derivedChipIds,
    ]);
    const out: Record<
      "standard" | "extension",
      Record<string, GetBehaviorDetailsResponse[]>
    > = { standard: {}, extension: {} };
    for (const b of sortedBehaviors) {
      if (hiddenIds.has(b.id)) continue;
      const { tier, group } = classifyBehavior(b);
      if (!out[tier][group]) out[tier][group] = [];
      out[tier][group].push(b);
    }
    return out;
  }, [sortedBehaviors, clearBehaviors, derivedChipIds]);

  const tiers: { key: "standard" | "extension"; title: string }[] = [
    { key: "standard", title: "ZMK Standard" },
    { key: "extension", title: "Firmware Extension" },
  ];

  const currentBehavior = behaviors.find((b) => b.id === behaviorId);
  const currentClass = currentBehavior
    ? classifyBehavior(currentBehavior)
    : null;

  const [activeTier, setActiveTier] = useState<"standard" | "extension">(
    currentClass?.tier ?? "standard"
  );
  const [activeGroup, setActiveGroup] = useState<string>(
    currentClass?.group ?? "Basic"
  );

  // When the bound behavior changes (e.g. user clicked a different key on the
  // keyboard image), jump the picker tabs to the matching tier/group.
  useEffect(() => {
    if (!currentClass) return;
    setActiveTier(currentClass.tier);
    setActiveGroup(currentClass.group);
  }, [behaviorId]);

  const availableTiers = tiers.filter((t) =>
    Object.values(tieredBehaviors[t.key]).some((arr) => arr.length > 0)
  );
  const availableGroupsForActiveTier = GROUP_ORDER.filter(
    (g) => tieredBehaviors[activeTier][g]?.length
  );
  const effectiveGroup = availableGroupsForActiveTier.includes(activeGroup)
    ? activeGroup
    : availableGroupsForActiveTier[0];

  const selectBehavior = (id: number) => {
    if (id !== behaviorId) {
      setBehaviorId(id);
      setParam1(0);
      setParam2(0);
    }
  };

  // Shared look for the selectable behavior chips, so a future style tweak
  // stays consistent across the picker.
  const chipClass = (selected: boolean) =>
    `px-3 py-1 rounded border text-sm ${
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
  const setBindingFromSlots = (b: BehaviorBinding) => {
    setBehaviorId(b.behaviorId);
    setParam1(b.param1);
    setParam2(b.param2);
  };

  return (
    <div className="flex flex-col gap-3">
      <SlotBindingPicker
        binding={currentBinding}
        registry={registry}
        layers={layers}
        onBindingChanged={setBindingFromSlots}
        clearTiles={clearTiles}
      />
      <div className="flex flex-col gap-1 border-t pt-2">
        <label className="text-sm uppercase tracking-widest font-bold text-primary">
          Not yet on the slot surface
        </label>
        <p className="text-xs text-base-content/60">
          Temporary home for behaviors the slots don&apos;t cover yet — these move
          onto tiles and the slot surface in later steps.
        </p>
        <div className="flex flex-col gap-1">
          <div role="tablist" aria-label="Behavior tier" className="flex border-b">
              {availableTiers.map((tier) => {
                const isActive = activeTier === tier.key;
                return (
                  <button
                    key={tier.key}
                    role="tab"
                    type="button"
                    aria-selected={isActive}
                    onClick={() => {
                      setActiveTier(tier.key);
                      // Reset to the leftmost category of the new tier so the
                      // previous tier's context (e.g. Hold-Tap selected in
                      // Firmware Ext) doesn't carry over and look pre-selected.
                      const firstGroup = GROUP_ORDER.find(
                        (g) => tieredBehaviors[tier.key][g]?.length
                      );
                      if (firstGroup) {
                        setActiveGroup(firstGroup);
                      }
                    }}
                    className={`px-4 py-1 text-base ${
                      isActive
                        ? "border-b-2 border-primary text-primary font-semibold"
                        : "text-base-content/80 hover:text-base-content"
                    }`}
                  >
                    {tier.title}
                  </button>
                );
              })}
            </div>
            <div
              role="tablist"
              aria-label="Behavior category"
              className="flex flex-wrap gap-1"
            >
              {availableGroupsForActiveTier.map((g) => {
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
            <div
              role="radiogroup"
              aria-label="Behavior"
              className="flex flex-wrap gap-1 pt-1"
            >
              {(tieredBehaviors[activeTier][effectiveGroup] || []).map(
                renderBehaviorChip
              )}
            </div>
        </div>
      </div>
      {/* Core behaviors are edited on the slot surface above; only non-core
          behaviors (Sticky Key, Mouse, System, ...) keep the params picker. */}
      {metadata && !isCoreBinding && (
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
