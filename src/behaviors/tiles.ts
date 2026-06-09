// Tile model for the binding editor (issue #16, Step 3a).
//
// Step 2 moved the core typing/layer/hold-tap behaviors onto the slot surface.
// Step 3a turns the remaining *single-action* behaviors — Mouse, Bluetooth,
// Output, External Power, System (Reset / Bootloader / Studio Unlock), and the
// parameterless Caps Word / Key Repeat / Grave-Escape — into grids of tiles,
// one tile per finished binding (design note §3a, shape (a)).
//
// A behavior is **tile-able** only when every parameter it takes is a fixed
// value the UI can pre-bake: `constant`, `range` (exploded into one tile per
// value), `nil`, or absent. A parameter that needs a rich picker — a HID key
// (`hidUsage`: `&sk` / `&kt`) or a layer (`layerId`: the persistent-layer
// behaviors) — makes the behavior *not* tile-able, so it keeps the existing
// chip + parameter-picker flow. `tileBindingsFor` returns `null` for those.

import type {
  BehaviorParameterValueDescription,
  GetBehaviorDetailsResponse,
} from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import type { BehaviorBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";

/** One finished binding the user can pick with a single tile press. */
export interface BehaviorTile {
  /** Label shown on the tile (e.g. "BT_SEL 0", "Reset"). */
  label: string;
  binding: BehaviorBinding;
}

/** A labelled run of tiles within a tab (one heading per source behavior). */
export interface BindingTileSection {
  heading: string;
  tiles: BehaviorTile[];
}

/**
 * A whole-binding tile tab shown alongside the keycode tabs in the Normal-slot
 * surface (e.g. "Mouse", "System"). Picking a tile sets the entire binding,
 * unlike the keycode tabs which set the Normal key.
 */
export interface BindingTileTab {
  name: string;
  sections: BindingTileSection[];
  /**
   * Behavior ids that count as the same "family" as this tab's tiles for the
   * purpose of highlighting / jumping. The Layer tab's tiles are `&to <layer>`,
   * but `&sl`/`&tog` (Sticky/Toggle Layer, applied via the latch) should still
   * light up their layer's tile — so the tab lists `[to, sl, tog]` and a binding
   * whose id is in this set matches the tile with the same `param1` (layer).
   */
  matchFamily?: number[];
}

/** One concrete value a parameter slot can take, with its label fragment. */
interface ParamValue {
  value: number;
  /** The metadata name for this value, if any (constants / range index). */
  label?: string;
}

/**
 * Enumerate the concrete values a single parameter slot accepts. An absent or
 * empty slot yields a single `{ value: 0 }` (the binding still needs a numeric
 * param). Returns `null` when the slot needs a rich picker (`hidUsage` /
 * `layerId`), marking the whole behavior as not tile-able.
 */
function enumerateParam(
  values: BehaviorParameterValueDescription[] | undefined
): ParamValue[] | null {
  if (!values || values.length === 0) {
    return [{ value: 0 }];
  }
  const out: ParamValue[] = [];
  for (const v of values) {
    if (v.constant !== undefined) {
      out.push({ value: v.constant, label: v.name });
    } else if (v.range) {
      // Explode the range into one tile per value (e.g. BT profile 0..N).
      for (let i = v.range.min; i <= v.range.max; i++) {
        out.push({ value: i, label: i.toString() });
      }
    } else if (v.nil) {
      out.push({ value: 0 });
    } else {
      // hidUsage / layerId: needs a picker, so the behavior isn't tile-able.
      return null;
    }
  }
  return out;
}

/**
 * Expand a behavior into one tile per concrete `(param1, param2)` combination,
 * or `null` when the behavior isn't tile-able (any parameter needs a rich
 * picker). A parameterless behavior (empty `metadata`) yields a single tile
 * labelled with its display name.
 */
export function tileBindingsFor(
  behavior: GetBehaviorDetailsResponse
): BehaviorTile[] | null {
  const sets = behavior.metadata;
  if (!sets || sets.length === 0) {
    return [
      {
        label: behavior.displayName,
        binding: { behaviorId: behavior.id, param1: 0, param2: 0 },
      },
    ];
  }

  const tiles: BehaviorTile[] = [];
  for (const set of sets) {
    const p1Values = enumerateParam(set.param1);
    if (p1Values === null) return null;
    const p2Values = enumerateParam(set.param2);
    if (p2Values === null) return null;

    for (const p1 of p1Values) {
      for (const p2 of p2Values) {
        const parts = [p1.label, p2.label].filter(
          (s): s is string => s !== undefined && s.length > 0
        );
        tiles.push({
          label: parts.length > 0 ? parts.join(" ") : behavior.displayName,
          binding: {
            behaviorId: behavior.id,
            param1: p1.value,
            param2: p2.value,
          },
        });
      }
    }
  }
  return tiles;
}

/** Whether a behavior renders as tiles (vs. the chip + parameter-picker flow). */
export function isTileable(behavior: GetBehaviorDetailsResponse): boolean {
  return tileBindingsFor(behavior) !== null;
}

/**
 * Whether a behavior takes exactly one HID-key parameter and nothing else
 * (Sticky Key, Key Toggle). Such a behavior wraps a single key, so the slot
 * surface offers it as a *key-state latch* applied to the Normal key (design
 * §3c) rather than a tile. Note Key Press shares this shape; callers that want
 * only the latch behaviors must exclude the slot-model core behaviors.
 */
export function isParamTileable(behavior: GetBehaviorDetailsResponse): boolean {
  const sets = behavior.metadata;
  if (!sets || sets.length !== 1) return false;
  const p1 = sets[0].param1 ?? [];
  const p2 = sets[0].param2 ?? [];
  return p1.length === 1 && !!p1[0].hidUsage && p2.length === 0;
}

/**
 * Whether a behavior takes exactly one layer parameter and nothing else: the
 * persistent layer switches To / Toggle / Sticky Layer (also Momentary Layer,
 * which the caller excludes as a slot-model core). Such a behavior is a finished
 * binding once a layer is chosen, so it's exploded into one tile per layer
 * (issue #16, Step 4 — the Normal grid's "Layer" tab).
 */
export function isLayerTileable(behavior: GetBehaviorDetailsResponse): boolean {
  const sets = behavior.metadata;
  if (!sets || sets.length !== 1) return false;
  const p1 = sets[0].param1 ?? [];
  const p2 = sets[0].param2 ?? [];
  return p1.length === 1 && !!p1[0].layerId && p2.length === 0;
}

/**
 * Expand a single-layer-param behavior into one finished tile per layer, or
 * `null` when it isn't that shape. The tile label is the layer's name (falling
 * back to its index); the section heading names the behavior (To / Toggle /
 * Sticky Layer), so a bare layer name reads unambiguously.
 */
export function layerTileBindingsFor(
  behavior: GetBehaviorDetailsResponse,
  layers: { id: number; name: string }[]
): BehaviorTile[] | null {
  if (!isLayerTileable(behavior)) return null;
  return layers.map((l, i) => ({
    label: l.name || i.toString(),
    binding: { behaviorId: behavior.id, param1: l.id, param2: 0 },
  }));
}
