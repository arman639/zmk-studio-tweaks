// The slot-fill binding surface (issue #16, Step 2). The user fills a Tap slot
// and a Hold slot; the behavior (&kp / &mt / &lt / &mo / &none) is *derived*
// from which slots are filled rather than named first. See
// `docs/design/key-picker-rethink.md` §2-§3 and the pure model in `slots.ts`.

import { useEffect, useState } from "react";
import { Search } from "lucide-react";

import { BehaviorBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";

import { ClearTilesConfig, HidUsagePicker } from "./HidUsagePicker";
import { BehaviorTile, BindingTileTab } from "./tiles";
import {
  bindingToSlots,
  CORE_LABELS,
  deriveBinding,
  DerivationRegistry,
  HoldSlot,
  HOLD_MODIFIERS,
  modifierSetFromUsage,
  Slots,
  usageFromModifierSet,
} from "./slots";
import { hid_usage_get_label, hid_usage_page_and_id_from_usage } from "../hid-usages";
import { useHostLayout } from "../layouts/LayoutContext";
import type { HostLayout } from "../layouts";

/**
 * The behavior ids for one latch "family": a `base` (plain) the latch wraps into
 * a `sticky` (one-shot) or `toggle` (latched) variant — `&kp`/`&sk`/`&kt` for
 * keys, `&to`/`&sl`/`&tog` for layers. Each id is optional (capability-aware).
 */
export interface LatchConfig {
  base?: number;
  sticky?: number;
  toggle?: number;
}

export interface SlotBindingPickerProps {
  binding: BehaviorBinding;
  registry: DerivationRegistry;
  layers: { id: number; name: string }[];
  onBindingChanged: (binding: BehaviorBinding) => void;
  /**
   * The persistent None / Transparent clear tiles (Step 1), threaded onto the
   * Tap grid so one-click clear survives on the slot surface. (Transparent is
   * not slot-derivable, so it still needs a tile here.)
   */
  clearTiles?: ClearTilesConfig;
  /**
   * Whole-binding behavior tabs (Mouse / System) shown in the Normal key grid's
   * tab strip — single-action behaviors picked the same way a keycode is
   * (issue #16, Step 3). Selecting one calls {@link onBindingChanged}.
   */
  behaviorTabs?: BindingTileTab[];
  /**
   * Rarely-used one-tap "flavor" behaviors (Caps Word / Key Repeat / Grave-
   * Escape) shown in the Normal grid's Apps/Media/Special tab (issue #16).
   * Selecting one calls {@link onBindingChanged}.
   */
  specialTiles?: BehaviorTile[];
  /**
   * The key-family latch ids: a base (`&kp`) the latch wraps into Sticky (`&sk`)
   * or Toggle (`&kt`). Shown as a generic "Sticky / Toggle" pair on the slot
   * label when the current binding is a key (issue #16, Steps 3b/4).
   */
  keyLatch?: LatchConfig;
  /**
   * The layer-family latch ids: a base (`&to`) wrapped into Sticky (`&sl`) or
   * Toggle (`&tog`). The *same* "Sticky / Toggle" pair maps here instead when the
   * current binding is a layer switch — `&sk`/`&kt` are to a key what `&sl`/`&tog`
   * are to a layer (issue #16, Step 4).
   */
  layerLatch?: LatchConfig;
  /**
   * The Mod-Tap identity choices: `&mt` plus any custom hold-taps of the same
   * shape (e.g. `homerow_mods`). When more than one exists, the Hold-mode
   * Modifier panel shows a selector so a `key + mod` fill can derive to the
   * chosen behavior (issue #16 §8 Q2). First entry is the default (`&mt`).
   */
  modTapOptions?: { id: number; name: string }[];
  /**
   * The Layer-Tap identity choices: `&lt` plus any custom layer-taps. Same as
   * {@link modTapOptions} but for the Hold-mode Layer sub-mode (a `key + layer`
   * fill). First entry is the default (`&lt`).
   */
  layerTapOptions?: { id: number; name: string }[];
  /**
   * Display name of the current behavior when it is *not* a slot-derivable core
   * (e.g. a Mouse / System tile). Shown in the reverse-lookup label instead of
   * "No matching behavior".
   */
  currentBehaviorName?: string;
  /**
   * The current binding rendered as ZMK devicetree code (e.g. `&mt LSHFT RET`),
   * shown alongside the reverse-lookup label so ZMK users see exactly what's set.
   */
  bindingCode?: string;
}

const EMPTY_SLOTS: Slots = { tap: { kind: "empty" }, hold: { kind: "empty" } };

const TAP_USAGE_PAGES = [
  { id: 7, min: 4 },
  { id: 12 },
];

type HoldMode = "mod" | "layer";

const segmentClass = (active: boolean) =>
  `px-2 py-1 text-sm border first:rounded-l last:rounded-r -ml-px first:ml-0 ${
    active
      ? "bg-primary text-primary-content border-primary z-10"
      : "bg-base-100 hover:bg-base-200 border-base-300"
  }`;

const chipClass = (active: boolean) =>
  `px-3 py-1 rounded border text-sm ${
    active
      ? "bg-primary text-primary-content border-primary"
      : "bg-base-200 hover:bg-base-300 border-base-300"
  }`;

function tapLabel(slot: Slots["tap"], layout: HostLayout): string {
  if (slot.kind === "empty") return "—";
  // Strip the implicit-modifier high byte before resolving the label, then show
  // those "+ Send with" modifiers as a prefix (e.g. `LC(S)` → "L Ctrl + S").
  // Without the strip, the modified value mis-reads its page and falls back to a
  // raw `0x…`. Resolve with the host layout so the glyph matches the grid (e.g.
  // on JIS, Shift+2 is `"`, not the ANSI `@`).
  const base = slot.usage & 0x00ffffff;
  const [page, id] = hid_usage_page_and_id_from_usage(base);
  const key = hid_usage_get_label(page, id, layout) ?? `0x${base.toString(16)}`;
  const mods = HOLD_MODIFIERS.filter(
    (m) => ((slot.usage >>> 24) & m.bit) !== 0
  ).map((m) => m.label);
  return mods.length ? `${mods.join(" + ")} + ${key}` : key;
}

export const SlotBindingPicker = ({
  binding,
  registry,
  layers,
  onBindingChanged,
  clearTiles,
  behaviorTabs,
  specialTiles,
  keyLatch,
  layerLatch,
  modTapOptions,
  layerTapOptions,
  currentBehaviorName,
  bindingCode,
}: SlotBindingPickerProps) => {
  const slots = bindingToSlots(binding, registry) ?? EMPTY_SLOTS;
  const layout = useHostLayout();

  // One generic Sticky / Toggle latch maps to whichever family the current
  // binding belongs to: layer (&to/&sl/&tog) when the bound id is in the layer
  // latch, else key (&kp/&sk/&kt). The wrapped value is always `param1` (the key
  // or the layer), so toggling just swaps the behavior id and carries param1.
  const inFamily = (latch: LatchConfig | undefined, id: number) =>
    !!latch &&
    (id === latch.base || id === latch.sticky || id === latch.toggle);
  const isLayerFamily = inFamily(layerLatch, binding.behaviorId);
  const activeLatch = isLayerFamily ? layerLatch! : keyLatch ?? {};
  const isSticky =
    activeLatch.sticky !== undefined && binding.behaviorId === activeLatch.sticky;
  const isToggle =
    activeLatch.toggle !== undefined && binding.behaviorId === activeLatch.toggle;
  const isLatched = isSticky || isToggle;
  // A key latch makes the Normal grid the picker for the latched key; a layer
  // latch's value lives in the Layer tab, so the grid stays empty for it.
  const keyLatched = !isLayerFamily && isLatched;

  // The Normal key being edited (key family only): the latched key's param, or
  // the core slot's tap (kp param1, mt/lt tap key). Layer family has no Normal key.
  const normalKey = isLayerFamily
    ? undefined
    : keyLatched
      ? binding.param1 || undefined
      : slots.tap.kind === "key"
        ? slots.tap.usage
        : undefined;

  // Search for the Normal key grid is hosted here (on the NORMAL header row) and
  // fed to the grid, so the grid drops its own "Key" header.
  const [search, setSearch] = useState("");

  const holdFilled = slots.hold.kind !== "empty";

  // Normal is always shown — every key has a Normal action, and None is a value
  // (the in-grid clear tile), not an "off" state. Only Hold mode is optional: its
  // picker shows when a hold value is set or the user ticks "Hold mode" to add
  // one; unticking clears it. The flag resets when the bound key changes, so
  // opening a plain &kp reads as Normal-only (Hold mode off) at a glance.
  const [holdModeOn, setHoldModeOn] = useState(false);
  useEffect(() => {
    setHoldModeOn(false);
  }, [binding.behaviorId, binding.param1, binding.param2]);
  const holdOpen = holdFilled || holdModeOn;

  // The Hold sub-type (Modifier vs Layer) is local UI state: ticking Hold mode
  // should reveal a picker before a value is chosen. Seed it from the current
  // hold and follow the bound key when it changes.
  const holdKind = slots.hold.kind;
  const [holdMode, setHoldMode] = useState<HoldMode>(
    holdKind === "layer" ? "layer" : "mod"
  );
  useEffect(() => {
    if (holdKind !== "empty") setHoldMode(holdKind);
  }, [holdKind]);

  // The chosen Mod-Tap identity (`&mt` or a custom hold-tap). Kept as local state
  // so it can be picked *before* a modifier exists — a plain `&kp` can't carry the
  // identity, so we hold it here and inject it on derive (a key+mod fill becomes
  // the chosen behavior). Reseeded from the binding whenever the bound key changes.
  const [holdTapId, setHoldTapId] = useState<number | undefined>(slots.holdTapId);
  useEffect(() => {
    setHoldTapId(slots.holdTapId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binding.behaviorId, binding.param1, binding.param2]);

  const writeSlots = (next: Slots) => {
    // Inject the chosen identity so a key+mod fill derives to it (default `&mt`).
    const derived = deriveBinding({ ...next, holdTapId }, registry);
    if (derived) onBindingChanged(derived);
  };

  // Picking a key from the grid sets the Normal key. When a *key* latch is active
  // the key is the latch behavior's param so the latch is kept; otherwise it
  // flows through the core slot model (→ &kp / &mt / ...). (A layer latch's value
  // is the layer, picked from the Layer tab, so the grid still writes a plain key
  // — a deliberate "switch back to a key" escape.)
  const setNormalKey = (usage?: number) => {
    if (keyLatched) {
      onBindingChanged({
        behaviorId: binding.behaviorId,
        param1: usage ?? 0,
        param2: 0,
      });
      return;
    }
    writeSlots({
      ...slots,
      tap: usage === undefined ? { kind: "empty" } : { kind: "key", usage },
    });
  };

  const setHold = (hold: HoldSlot) => writeSlots({ ...slots, hold });

  const toggleHoldMode = () => {
    if (holdOpen) {
      setHoldModeOn(false);
      if (holdFilled) setHold({ kind: "empty" });
    } else {
      setHoldModeOn(true);
    }
  };

  const modBits = slots.hold.kind === "mod" ? modifierSetFromUsage(slots.hold.usage) : 0;
  const toggleMod = (bit: number) => {
    const bits = modBits ^ bit;
    const usage = usageFromModifierSet(bits);
    setHold(usage === 0 ? { kind: "empty" } : { kind: "mod", usage });
  };

  // The hold-tap identity selector: `&mt` vs a custom mod-tap (Modifier sub-mode),
  // or `&lt` vs a custom layer-tap (Layer sub-mode). Shown whenever the user is
  // composing a hold-tap — a Normal key set and a hold sub-mode — even before a
  // value is picked, so it's discoverable (the choice applies the moment a
  // modifier/layer is added). Only shown when there's a choice to make.
  const identityOptions = holdMode === "mod" ? modTapOptions : layerTapOptions;
  const showHoldTapIdentity =
    slots.tap.kind === "key" && (identityOptions?.length ?? 0) > 1;
  // A held identity from the *other* family (a stale id after switching sub-mode)
  // isn't in this list, so fall back to the default (first) entry.
  const activeHoldTapId =
    identityOptions?.some((o) => o.id === holdTapId)
      ? holdTapId
      : identityOptions?.[0]?.id;
  const chooseHoldTap = (id: number) => {
    setHoldTapId(id);
    // If it's already a real hold-tap (a modifier/layer is set), re-derive now;
    // otherwise the choice waits in local state and applies when one is added.
    if (slots.hold.kind !== "empty") {
      const derived = deriveBinding({ ...slots, holdTapId: id }, registry);
      if (derived) onBindingChanged(derived);
    }
  };

  // The latched value (the key or layer) rides along in param1 across the whole
  // family, so toggling just swaps the behavior id and keeps param1.
  const latchParam = binding.param1;
  // Unwrap to the family base: a layer goes straight to &to <layer>; a key goes
  // through the slot model so an empty key collapses to &none rather than &kp 0.
  const unwrapLatch = () => {
    if (isLayerFamily && activeLatch.base !== undefined) {
      onBindingChanged({ behaviorId: activeLatch.base, param1: latchParam, param2: 0 });
    } else {
      writeSlots({
        tap: latchParam ? { kind: "key", usage: latchParam } : { kind: "empty" },
        hold: { kind: "empty" },
      });
    }
  };
  // Toggling Sticky / Toggle wraps the current binding into the matching family
  // variant, or unwraps to the base when it's already active (mutually exclusive).
  const toggleLatch = (variant: "sticky" | "toggle") => {
    const active = variant === "sticky" ? isSticky : isToggle;
    const targetId = variant === "sticky" ? activeLatch.sticky : activeLatch.toggle;
    if (active) unwrapLatch();
    else if (targetId !== undefined)
      onBindingChanged({ behaviorId: targetId, param1: latchParam, param2: 0 });
  };

  // Picking a To-Layer tile (from the Layer tab) while a latch is active keeps
  // the latch and retargets it to that layer (&to -> &sl/&tog) — so switching a
  // key latch onto a layer preserves the Sticky/Toggle choice. Other behavior
  // tiles (Mouse / System) pass through unchanged.
  const handleSelectBinding = (b: BehaviorBinding) => {
    if (layerLatch && b.behaviorId === layerLatch.base) {
      if (isSticky && layerLatch.sticky !== undefined)
        return onBindingChanged({ behaviorId: layerLatch.sticky, param1: b.param1, param2: 0 });
      if (isToggle && layerLatch.toggle !== undefined)
        return onBindingChanged({ behaviorId: layerLatch.toggle, param1: b.param1, param2: 0 });
    }
    onBindingChanged(b);
  };

  // The generic Sticky / Toggle checkboxes — only those the current family
  // actually exposes (capability-aware).
  const latchOptions: { variant: "sticky" | "toggle"; label: string; active: boolean }[] = [];
  if (activeLatch.sticky !== undefined)
    latchOptions.push({ variant: "sticky", label: "Sticky", active: isSticky });
  if (activeLatch.toggle !== undefined)
    latchOptions.push({ variant: "toggle", label: "Toggle", active: isToggle });

  const derivedName = (() => {
    const core = registry.coreById.get(binding.behaviorId);
    if (core) return CORE_LABELS[core];
    // Non-core: a Mouse / System tile (or other behavior) — name it rather than
    // showing "No matching behavior", so the slot label always reflects reality.
    return currentBehaviorName ?? "No matching behavior";
  })();

  const hold = slots.hold;
  const holdSummary =
    hold.kind === "mod"
      ? HOLD_MODIFIERS.filter((m) => modBits & m.bit)
          .map((m) => m.label)
          .join(" + ")
      : hold.kind === "layer"
        ? layers.find((l) => l.id === hold.layerId)?.name ??
          `Layer ${hold.layerId}`
        : "";

  const slotLabelClass =
    "text-sm uppercase tracking-widest font-bold text-primary";
  const helpClass = "text-xs text-base-content/60";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-sm uppercase tracking-widest font-bold text-primary">
          Slots
        </span>
        <span className="text-sm text-base-content/70">
          = <span className="font-medium text-base-content">{derivedName}</span>
        </span>
        {bindingCode && (
          <code className="ml-2 px-2 py-0.5 rounded-md border border-primary/40 bg-primary/10 text-primary text-sm font-mono">
            {bindingCode}
          </code>
        )}

        {/* Generic Sticky / Toggle latch: wraps the current binding into its
            family variant (key → &sk/&kt, layer → &sl/&tog) keeping the param.
            Mutually exclusive with Hold mode, so disabled while a hold is set. */}
        {latchOptions.length > 0 && (
          <div
            className="ml-auto flex items-center gap-3"
            role="group"
            aria-label="Sticky / toggle latch"
          >
            <span className="text-xs uppercase tracking-widest font-bold text-primary">
              Latch
            </span>
            {latchOptions.map((o) => {
              const disabled = holdOpen && !o.active;
              return (
                <label
                  key={o.variant}
                  className={`flex items-center gap-1.5 select-none text-sm ${
                    disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={o.active}
                    disabled={disabled}
                    onChange={() => toggleLatch(o.variant)}
                    className="w-4 h-4 accent-primary cursor-pointer disabled:cursor-not-allowed"
                  />
                  {o.label}
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Normal (always shown — the key's base action) and an optional Hold mode
          (a different action when held). Only Hold mode has an on/off toggle: a
          plain &kp reads as Normal-only, a &mo as Hold-mode-only. */}
      <div className="flex gap-3">
        {/* Hold mode adds a different action when held (→ &mt / &lt / &mo). A
            latched binding (Sticky / Toggle) has no hold half, so the toggle is
            disabled while a latch is active. */}
        <div className="w-52 shrink-0 flex flex-col gap-2 border-r pr-3">
          <label
            className={`flex items-center gap-2 select-none ${
              isLatched ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
            }`}
          >
            <input
              type="checkbox"
              checked={holdOpen}
              onChange={toggleHoldMode}
              disabled={isLatched}
              className="w-4 h-4 accent-primary cursor-pointer disabled:cursor-not-allowed"
              aria-label="Hold mode"
            />
            <span className={slotLabelClass}>Hold mode</span>
            {holdFilled && holdSummary && (
              <span className="text-sm font-medium">{holdSummary}</span>
            )}
          </label>

          {holdOpen ? (
            <>
              <div
                className="flex flex-wrap gap-1"
                role="radiogroup"
                aria-label="Hold type"
              >
                {(["mod", "layer"] as HoldMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={holdMode === mode}
                    onClick={() => setHoldMode(mode)}
                    className={segmentClass(holdMode === mode)}
                  >
                    {mode === "mod" ? "Modifier" : "Layer"}
                  </button>
                ))}
              </div>

              {holdMode === "mod" && (
                <div
                  role="group"
                  aria-label="Held modifiers"
                  className="grid grid-cols-2 gap-1"
                >
                  {HOLD_MODIFIERS.map((m) => {
                    const active = (modBits & m.bit) !== 0;
                    return (
                      <button
                        key={m.bit}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleMod(m.bit)}
                        className={chipClass(active)}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {holdMode === "layer" && (
                <div
                  role="radiogroup"
                  aria-label="Hold layer"
                  className="flex flex-wrap gap-1"
                >
                  {layers.map(({ id, name }, i) => {
                    const active =
                      slots.hold.kind === "layer" && slots.hold.layerId === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setHold({ kind: "layer", layerId: id })}
                        className={chipClass(active)}
                      >
                        {name || i.toLocaleString()}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Hold-tap identity: which behavior a key+hold fill becomes when the
                  keymap defines custom hold-taps alongside the standard &mt / &lt
                  (Mod-Tap in the Modifier sub-mode, Layer-Tap in Layer; §8 Q2). */}
              {showHoldTapIdentity && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide font-semibold text-base-content/60">
                    Hold-tap
                  </span>
                  <div
                    className="flex flex-wrap"
                    role="radiogroup"
                    aria-label="Hold-tap behavior"
                  >
                    {identityOptions!.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        role="radio"
                        aria-checked={activeHoldTapId === o.id}
                        onClick={() => chooseHoldTap(o.id)}
                        className={segmentClass(activeHoldTapId === o.id)}
                      >
                        {o.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className={helpClass}>
              {isLatched
                ? "A latched binding has no hold."
                : "A different action while held — a modifier or layer."}
            </p>
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className={slotLabelClass}>Normal</span>
            {normalKey !== undefined ? (
              <span className="text-sm font-medium">
                {tapLabel({ kind: "key", usage: normalKey }, layout)}
              </span>
            ) : keyLatched ? (
              <span className={helpClass}>Pick the key to latch.</span>
            ) : (
              <span className={helpClass}>The key sent on a normal press.</span>
            )}
            <div className="ml-auto relative w-64 max-w-full">
              <Search className="size-4 absolute left-2 top-1/2 -translate-y-1/2 text-base-content/50 pointer-events-none" />
              <input
                type="search"
                aria-label="Filter keys"
                placeholder="Filter keys..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-2 py-1 rounded border border-base-300 bg-base-100 focus:outline-none focus:border-primary text-sm"
              />
            </div>
          </div>

          <HidUsagePicker
            label="Normal key"
            value={normalKey}
            usagePages={TAP_USAGE_PAGES}
            onValueChanged={setNormalKey}
            clearTiles={clearTiles}
            extraTabs={behaviorTabs}
            specialTiles={specialTiles}
            activeBinding={binding}
            onSelectBinding={handleSelectBinding}
            keyOnly={keyLatched}
            inline
            search={search}
            onSearchChange={setSearch}
            modifiers={{
              label: "Send with",
            }}
          />
        </div>
      </div>
    </div>
  );
};
