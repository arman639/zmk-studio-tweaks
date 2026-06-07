// The slot-fill binding surface (issue #16, Step 2). The user fills a Tap slot
// and a Hold slot; the behavior (&kp / &mt / &lt / &mo / &none) is *derived*
// from which slots are filled rather than named first. See
// `docs/design/key-picker-rethink.md` §2-§3 and the pure model in `slots.ts`.

import { useEffect, useState } from "react";
import { Search } from "lucide-react";

import { BehaviorBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";

import { ClearTilesConfig, HidUsagePicker } from "./HidUsagePicker";
import { BindingTileTab } from "./tiles";
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
  currentBehaviorName,
  bindingCode,
}: SlotBindingPickerProps) => {
  const slots = bindingToSlots(binding, registry) ?? EMPTY_SLOTS;
  const layout = useHostLayout();

  // Search for the Normal key grid is hosted here (on the NORMAL header row) and
  // fed to the grid, so the grid drops its own "Key" header.
  const [search, setSearch] = useState("");

  const tapFilled = slots.tap.kind === "key";
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

  const writeSlots = (next: Slots) => {
    const derived = deriveBinding(next, registry);
    if (derived) onBindingChanged(derived);
  };

  const setNormalKey = (usage?: number) =>
    writeSlots({
      ...slots,
      tap: usage === undefined ? { kind: "empty" } : { kind: "key", usage },
    });

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
      </div>

      {/* Normal (always shown — the key's base action) and an optional Hold mode
          (a different action when held). Only Hold mode has an on/off toggle: a
          plain &kp reads as Normal-only, a &mo as Hold-mode-only. */}
      <div className="flex gap-3">
        <div className="w-52 shrink-0 flex flex-col gap-2 border-r pr-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={holdOpen}
              onChange={toggleHoldMode}
              className="w-4 h-4 accent-primary cursor-pointer"
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
            </>
          ) : (
            <p className={helpClass}>
              A different action while held — a modifier or layer.
            </p>
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className={slotLabelClass}>Normal</span>
            {tapFilled ? (
              <span className="text-sm font-medium">{tapLabel(slots.tap, layout)}</span>
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
            value={slots.tap.kind === "key" ? slots.tap.usage : undefined}
            usagePages={TAP_USAGE_PAGES}
            onValueChanged={setNormalKey}
            clearTiles={clearTiles}
            extraTabs={behaviorTabs}
            activeBinding={binding}
            onSelectBinding={onBindingChanged}
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
