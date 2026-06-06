// Slot model for the binding editor (issue #16, Step 2).
//
// The picker historically asks the user to name a behavior first, then fill its
// parameters. The slot model inverts that for the typing + layer + hold-tap core
// (~90% of real keymaps): the user fills a **Tap** slot and a **Hold** slot, and
// the behavior is *derived* from which slots are filled. See
// `docs/design/key-picker-rethink.md` §2-§4.
//
//   | Tap slot       | Hold slot | Derived behavior  | Firmware            |
//   | -------------- | --------- | ----------------- | ------------------- |
//   | key            | (empty)   | Key Press         | &kp <key>           |
//   | key            | modifier  | Mod-Tap           | &mt <mod> <key>     |
//   | key            | layer     | Layer-Tap         | &lt <layer> <key>   |
//   | (empty / None) | layer     | Momentary Layer   | &mo <layer>         |
//   | (empty)        | modifier  | a plain held mod  | &kp <mod>           |
//   | (empty)        | (empty)   | None              | &none               |
//
// The output is still a plain `BehaviorBinding` handed to the existing
// `doUpdateBinding` path — no firmware or RPC change.

import type { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import type { BehaviorBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";

import { hid_usage_page_and_id_from_usage } from "../hid-usages";

// =============================================================================
// Slot types
// =============================================================================

/** The Tap slot holds a HID keyboard/consumer usage, or nothing. */
export type TapSlot = { kind: "empty" } | { kind: "key"; usage: number };

/**
 * The Hold slot is polymorphic: a held modifier (→ `&mt` / `&kp <mod>`), a layer
 * (→ `&lt` / `&mo`), or nothing. A *regular* key can never go on hold, so the
 * type itself makes the "key on hold" invalid combination unreachable.
 */
export type HoldSlot =
  | { kind: "empty" }
  | { kind: "mod"; usage: number }
  | { kind: "layer"; layerId: number };

export interface Slots {
  tap: TapSlot;
  hold: HoldSlot;
}

// =============================================================================
// Derivation registry (capability-aware, resolved by displayName)
// =============================================================================

/** The canonical ZMK behaviors the slot model derives. */
export type CoreBehavior = "kp" | "mt" | "lt" | "mo" | "none";

// displayName the connected firmware reports for each core behavior. Matching by
// displayName mirrors how the rest of the picker classifies behaviors; the
// numeric behaviorId is firmware-assigned at runtime and cannot be hardcoded.
const CORE_DISPLAY_NAMES: Record<CoreBehavior, string> = {
  kp: "Key Press",
  mt: "Mod-Tap",
  lt: "Layer-Tap",
  mo: "Momentary Layer",
  none: "None",
};

/**
 * A bidirectional map between core behaviors and the runtime behaviorIds the
 * connected keyboard exposes. Built from the `behaviors` array the picker
 * already receives; a core behavior the firmware does not expose is simply
 * absent, and every derivation tolerates that (capability-awareness).
 */
export interface DerivationRegistry {
  idByCore: Partial<Record<CoreBehavior, number>>;
  coreById: Map<number, CoreBehavior>;
}

export function buildDerivationRegistry(
  behaviors: GetBehaviorDetailsResponse[]
): DerivationRegistry {
  const idByCore: Partial<Record<CoreBehavior, number>> = {};
  const coreById = new Map<number, CoreBehavior>();
  for (const core of Object.keys(CORE_DISPLAY_NAMES) as CoreBehavior[]) {
    const behavior = behaviors.find(
      (b) => b.displayName === CORE_DISPLAY_NAMES[core]
    );
    if (behavior) {
      idByCore[core] = behavior.id;
      coreById.set(behavior.id, core);
    }
  }
  return { idByCore, coreById };
}

// =============================================================================
// Modifier detection
// =============================================================================

const HID_KEYBOARD_PAGE = 7;
const FIRST_MODIFIER_USAGE = 0xe0; // 224, Left Control
const LAST_MODIFIER_USAGE = 0xe7; // 231, Right GUI

/**
 * Whether a held HID usage reads as "a modifier" (so it lands in the Hold slot).
 *
 * ZMK packs implicit modifiers into the high byte of a usage value and keeps the
 * base HID usage in the low 24 bits. A value is a modifier when its *base* usage
 * — after stripping the implicit-mod bits — is one of the eight base HID
 * modifier usages (page 7, ids 0xE0..0xE7). Stripping first is essential: a
 * multi-modifier hold like `LC(LSHFT)` carries the LC bit in the high byte, so
 * matching the eight usages against the raw value would miss it and break the
 * binding → slots → binding round trip (design note §4). A shifted *key* such as
 * `LS(N1)` ("!") keeps a non-modifier base (N1) and is therefore a key, not a
 * modifier — it belongs in the Tap slot.
 */
export function isModifierUsage(usage: number): boolean {
  const base = usage & 0x00ffffff;
  const [page, id] = hid_usage_page_and_id_from_usage(base);
  return (
    page === HID_KEYBOARD_PAGE &&
    id >= FIRST_MODIFIER_USAGE &&
    id <= LAST_MODIFIER_USAGE
  );
}

// =============================================================================
// Derivation: slots → binding and binding → slots
// =============================================================================

function bindingFor(
  reg: DerivationRegistry,
  core: CoreBehavior,
  param1: number,
  param2: number
): BehaviorBinding | null {
  const behaviorId = reg.idByCore[core];
  if (behaviorId === undefined) return null; // firmware doesn't expose it
  return { behaviorId, param1, param2 };
}

/**
 * Derive the `BehaviorBinding` from the two filled slots, per the §2 table.
 * Returns `null` when the combination has no behavior the firmware exposes —
 * the surface should constrain inputs so that's rare, and reflect it in the
 * reverse-lookup label rather than silently writing nothing (design note §3b).
 */
export function deriveBinding(
  slots: Slots,
  reg: DerivationRegistry
): BehaviorBinding | null {
  const { tap, hold } = slots;

  if (tap.kind === "key") {
    switch (hold.kind) {
      case "empty":
        return bindingFor(reg, "kp", tap.usage, 0);
      case "mod":
        return bindingFor(reg, "mt", hold.usage, tap.usage);
      case "layer":
        return bindingFor(reg, "lt", hold.layerId, tap.usage);
    }
  }

  // Tap empty.
  switch (hold.kind) {
    case "empty":
      return bindingFor(reg, "none", 0, 0);
    case "mod":
      return bindingFor(reg, "kp", hold.usage, 0);
    case "layer":
      return bindingFor(reg, "mo", hold.layerId, 0);
  }
}

/**
 * Decompose an existing binding into slots, so opening a key pre-fills the slot
 * surface. Returns `null` for any behavior outside the derivable core (Sticky
 * Key, Caps Word, Mouse, …), which the caller keeps editing through the legacy
 * chip UI.
 *
 * The **binding** survives binding → slots → binding for every core behavior
 * ("binding-lossless"). The slot *decomposition* is heuristic only for `&kp`,
 * whose single param is read as a Hold (a lone modifier) or a Tap (any other
 * key) from the keycode's type — but both readings derive back to `&kp` with the
 * same param, so the binding never changes ("slot-lossless" is *not* claimed).
 */
export function bindingToSlots(
  binding: BehaviorBinding,
  reg: DerivationRegistry
): Slots | null {
  const core = reg.coreById.get(binding.behaviorId);
  if (!core) return null;

  switch (core) {
    case "kp":
      return isModifierUsage(binding.param1)
        ? { tap: { kind: "empty" }, hold: { kind: "mod", usage: binding.param1 } }
        : { tap: { kind: "key", usage: binding.param1 }, hold: { kind: "empty" } };
    case "mt":
      return {
        tap: { kind: "key", usage: binding.param2 },
        hold: { kind: "mod", usage: binding.param1 },
      };
    case "lt":
      return {
        tap: { kind: "key", usage: binding.param2 },
        hold: { kind: "layer", layerId: binding.param1 },
      };
    case "mo":
      return {
        tap: { kind: "empty" },
        hold: { kind: "layer", layerId: binding.param1 },
      };
    case "none":
      return { tap: { kind: "empty" }, hold: { kind: "empty" } };
  }
}
