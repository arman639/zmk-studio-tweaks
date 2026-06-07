import {
  BehaviorParameterValueDescription,
  BehaviorBindingParametersSet,
  GetBehaviorDetailsResponse,
} from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import { BehaviorBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import { hid_usage_page_and_id_from_usage } from "../hid-usages";
import { dtsRefForDisplayName, formatBindingParam } from "../keymap-parser";

export function validateValue(
  layerIds: number[],
  value?: number,
  values?: BehaviorParameterValueDescription[]
): boolean {
  if (value === undefined) {
    return values === undefined || values?.length === 0 || !!values[0].nil;
  }

  const matchingValue = values?.find((v) => {
    if (v.constant !== undefined) {
      return v.constant == value;
    } else if (v.range) {
      return value >= v.range.min && value <= v.range.max;
    } else if (v.hidUsage) {
      const [page, id] = hid_usage_page_and_id_from_usage(value);
      return page !== 0 && id !== 0;
    } else if (v.layerId) {
      return layerIds.includes(value);
    } else if (v.nil) {
      return value === 0;
    } else {
      console.error("Unknown check type!");
      return false;
    }
  });

  return !!matchingValue || (value === 0 && (!values || values.length === 0));
}

/**
 * Whether a (param1, param2) pair is a valid binding for a behavior with the
 * given metadata, gating writes the same way the firmware does. Exported so the
 * slot-model unit tests can assert every binding `deriveBinding` produces also
 * passes this check (design note §5, Step 2).
 */
export function validateBinding(
  metadata: BehaviorBindingParametersSet[],
  layerIds: number[],
  param1?: number,
  param2?: number
): boolean {
  if (
    (param1 === undefined || param1 === 0) &&
    metadata.every((s) => !s.param1 || s.param1.length === 0)
  ) {
    return true;
  }

  const matchingSet = metadata.find((s) =>
    validateValue(layerIds, param1, s.param1)
  );

  if (!matchingSet) {
    return false;
  }

  return validateValue(layerIds, param2, matchingSet.param2);
}

/**
 * Render a binding as the ZMK devicetree code a keymap author would write, e.g.
 * `&mt LSHFT RET`, `&kp A`, `&mo 1`, `&bt BT_SEL 0`, `&reset`. The behavior
 * reference comes from the displayName ({@link dtsRefForDisplayName}); each
 * parameter prefers its metadata constant name (the ZMK macro, e.g. `BT_SEL`)
 * and otherwise falls back to a keycode name / layer index
 * ({@link formatBindingParam}). Only the parameters the matching metadata set
 * actually defines are emitted, so a no-param behavior renders bare.
 */
export function formatBinding(
  binding: BehaviorBinding,
  behavior: GetBehaviorDetailsResponse | undefined,
  layerIds: number[]
): string {
  if (!behavior) return "";
  const ref = `&${dtsRefForDisplayName(behavior.displayName)}`;
  const sets = behavior.metadata ?? [];
  if (sets.length === 0) return ref;

  // No matching set → the binding's param1 fits none of the behavior's shapes;
  // emit just the reference rather than risk showing a param2 from a set that
  // doesn't actually apply.
  const set = sets.find((s) =>
    validateValue(layerIds, binding.param1, s.param1)
  );
  if (!set) return ref;
  const fmt = (
    value: number,
    descs: BehaviorParameterValueDescription[] | undefined
  ) => descs?.find((d) => d.constant === value)?.name ?? formatBindingParam(value);

  const parts = [ref];
  if (set.param1 && set.param1.length > 0) parts.push(fmt(binding.param1, set.param1));
  if (set.param2 && set.param2.length > 0) parts.push(fmt(binding.param2, set.param2));
  return parts.join(" ");
}
