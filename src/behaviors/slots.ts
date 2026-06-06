// Slot model for the binding editor (issue #16, Step 2).
//
// The picker historically asks the user to name a behavior first, then fill its
// parameters. The slot model inverts that for the typing + layer + hold-tap core
// (~90% of real keymaps): the user sets a **Normal** action (always present) and
// an optional **Hold mode** action, and the behavior is *derived*. The two slot
// fields below are still named `tap` / `hold` (the firmware's tap/hold params);
// the UI labels them Normal / Hold mode. See `docs/design/key-picker-rethink.md`
// §2 (esp. §2b: a lone modifier is a Normal keystroke, not a Hold).
//
//   | Normal (tap)   | Hold mode (hold) | Derived behavior | Firmware            |
//   | -------------- | ---------------- | ---------------- | ------------------- |
//   | key            | (off)            | Key Press        | &kp <key>           |
//   | modifier (key) | (off)            | Key Press        | &kp <mod>           |
//   | key            | modifier         | Mod-Tap          | &mt <mod> <key>     |
//   | key            | layer            | Layer-Tap        | &lt <layer> <key>   |
//   | (none)         | layer            | Momentary Layer  | &mo <layer>         |
//   | (none)         | (off)            | None             | &none               |
//
// The output is still a plain `BehaviorBinding` handed to the existing
// `doUpdateBinding` path — no firmware or RPC change.

import type { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import type { BehaviorBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";

import {
  hid_usage_from_page_and_id,
  hid_usage_page_and_id_from_usage,
} from "../hid-usages";

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

/** User-facing names for the reverse-lookup label on the slot surface. */
export const CORE_LABELS: Record<CoreBehavior, string> = CORE_DISPLAY_NAMES;

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

// The eight base HID modifiers, in implicit-bit order (bit i ↔ usage 0xE0+i),
// matching the LC/LS/.../RG flag order in keymap-parser. The Hold-slot modifier
// picker offers these as a multi-select: a held value combines one base usage
// (the lowest selected modifier) with implicit-modifier bits for the rest, e.g.
// Ctrl+Shift = LS(LCTRL) = base LCTRL + the LS bit.
export interface ModifierInfo {
  bit: number;
  usage: number;
  label: string;
}

export const HOLD_MODIFIERS: ReadonlyArray<ModifierInfo> = [
  { bit: 0x01, label: "L Ctrl" },
  { bit: 0x02, label: "L Shift" },
  { bit: 0x04, label: "L Alt" },
  { bit: 0x08, label: "L GUI" },
  { bit: 0x10, label: "R Ctrl" },
  { bit: 0x20, label: "R Shift" },
  { bit: 0x40, label: "R Alt" },
  { bit: 0x80, label: "R GUI" },
].map((m, i) => ({
  ...m,
  usage: hid_usage_from_page_and_id(HID_KEYBOARD_PAGE, FIRST_MODIFIER_USAGE + i),
}));

/**
 * Decode a held HID usage into the set of active modifiers, as a bitmask over
 * {@link HOLD_MODIFIERS} bits. Combines the implicit-modifier bits in the high
 * byte with the base usage (when the base is itself a modifier). Returns 0 for a
 * value that carries no modifiers.
 */
export function modifierSetFromUsage(usage: number): number {
  let bits = (usage >>> 24) & 0xff;
  const base = usage & 0x00ffffff;
  const [page, id] = hid_usage_page_and_id_from_usage(base);
  if (page === HID_KEYBOARD_PAGE && id >= FIRST_MODIFIER_USAGE && id <= LAST_MODIFIER_USAGE) {
    bits |= 1 << (id - FIRST_MODIFIER_USAGE);
  }
  return bits;
}

/**
 * Encode a modifier-bit set back into a single held HID usage: the lowest
 * selected modifier becomes the base usage, the rest ride along as implicit
 * bits (so Ctrl+Shift → `LS(LCTRL)`). Returns 0 for the empty set. Inverse of
 * {@link modifierSetFromUsage} up to modifier identity (the exact base/implicit
 * split is canonicalized, but the set of modifiers round-trips).
 */
export function usageFromModifierSet(bits: number): number {
  const masked = bits & 0xff;
  if (masked === 0) return 0;
  const lowest = masked & -masked;
  const index = Math.log2(lowest);
  const implicit = masked & ~lowest;
  return (
    hid_usage_from_page_and_id(HID_KEYBOARD_PAGE, FIRST_MODIFIER_USAGE + index) |
    (implicit << 24)
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
 * ("binding-lossless"): each core behavior stores its hold/tap explicitly, so
 * the decomposition is a direct read, not a heuristic. A lone modifier `&kp`
 * (e.g. `&kp LSHIFT`) decomposes to the Tap slot — it's a normal key, not a
 * hold — so the Hold slot's modifier mode is only ever the hold half of a
 * Mod-Tap.
 */
export function bindingToSlots(
  binding: BehaviorBinding,
  reg: DerivationRegistry
): Slots | null {
  const core = reg.coreById.get(binding.behaviorId);
  if (!core) return null;

  switch (core) {
    case "kp":
      // A `&kp` is a single keycode the user pressed — including a lone modifier
      // (`&kp LSHIFT` is just a normal Shift key), which is a *key*, not the hold
      // half of a Mod-Tap. So its param always lands in the Tap slot; the Hold
      // slot's modifier mode is reserved for Mod-Tap, where a tap is also present.
      return {
        tap: { kind: "key", usage: binding.param1 },
        hold: { kind: "empty" },
      };
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
