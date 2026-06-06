import {
  hid_usage_get_metadata,
  hid_usage_page_and_id_from_usage,
} from "../hid-usages";
import { useHostLayout } from "../layouts/LayoutContext";

export interface HidUsageLabelProps {
  hid_usage: number;
  /**
   * When true, render "1 !" as a single token instead of stacking the
   * shifted variant on top. Used by hold-tap previews where the badge and
   * hold label already eat most of the vertical budget.
   */
  compact?: boolean;
}

function remove_prefix(s?: string) {
  return s?.replace(/^Keyboard /, "");
}

// 1U keys are ~48px wide. text-base (~16px) bold fits about 4 glyphs before
// the label overflows and the parent's `truncate` clips it. Shrink relative
// to the parent so longer labels still fit without ellipsis.
function shrink_class_for(len: number): string {
  if (len <= 4) return "";
  if (len === 5) return "text-[0.82em]";
  if (len === 6) return "text-[0.7em]";
  if (len === 7) return "text-[0.6em]";
  return "text-[0.5em]";
}

export const HidUsageLabel = ({ hid_usage, compact }: HidUsageLabelProps) => {
  const layout = useHostLayout();
  const [pageWithMods, id] = hid_usage_page_and_id_from_usage(hid_usage);

  // The encoded value packs implicit-modifier bits into the high byte of
  // the page word: bit 1 / bit 5 = L Shift / R Shift, etc.
  const mods = (pageWithMods >> 8) & 0xff;
  const page = pageWithMods & 0xff;
  const shiftActive = (mods & (0x02 | 0x20)) !== 0;
  const otherMods = mods & ~(0x02 | 0x20) & 0xff;

  const labels = hid_usage_get_metadata(page, id, layout);

  // Implicit "+ Send with" modifiers shown as small bordered badges to the left
  // of the cap glyph (L/R collapsed), stacked vertically when there are several
  // — e.g. `LC(S)` reads "[Ctrl] S". Capped at three.
  const modBadges = (m: number) =>
    [
      m & 0x11 ? "Ctrl" : "",
      m & 0x22 ? "Shift" : "",
      m & 0x44 ? "Alt" : "",
      m & 0x88 ? "GUI" : "",
    ].filter(Boolean);
  // EXPERIMENT: badges at text-xs (same class as the hold preview, 6.4px).
  const withMods = (badges: string[], key: string) =>
    badges.length === 0 ? (
      <span>{key}</span>
    ) : (
      <span className="inline-flex flex-row items-center gap-px leading-none">
        <span className="inline-flex flex-col gap-0">
          {badges.slice(0, 3).map((b) => (
            <span
              key={b}
              className="text-xs leading-none rounded-sm border border-base-content/40 px-[0.15em] whitespace-nowrap"
            >
              {b}
            </span>
          ))}
        </span>
        <span>{key}</span>
      </span>
    );

  // Short labels like "1 !" / "- _" / "[ {" are unshifted+shifted pairs.
  // When an implicit Shift is applied the binding always types the shifted
  // glyph, so show just that (other modifiers ride beside it). Otherwise render
  // the pair stacked like a physical keycap — unless compact is requested.
  const short = labels.short || "";
  const pair = short.match(/^(\S{1,2}) (\S{1,2})$/);
  if (pair && shiftActive) {
    return withMods(modBadges(otherMods), pair[2]);
  }
  // Any other implicit modifier: badges beside the cap glyph (here Shift is not
  // a shifted glyph, so it joins the badges).
  if (mods) {
    return withMods(modBadges(mods), pair ? pair[1] : short);
  }
  if (pair && !compact) {
    return (
      <span className="inline-flex flex-col items-center leading-none gap-px">
        <span className="text-[0.7em] opacity-70">{pair[2]}</span>
        <span>{pair[1]}</span>
      </span>
    );
  }

  const shrink = shrink_class_for((labels.short || "").length);
  return (
    <span
      className={`${shrink} @[10em]:before:content-[attr(data-long-content)] @[6em]:before:content-[attr(data-med-content)] before:content-[attr(aria-label)]`}
      aria-label={labels.short}
      data-med-content={labels.med || labels.short}
      data-long-content={remove_prefix(
        labels.long || labels.med || labels.short
      )}
    />
  );
};
