import {
  Button,
  Checkbox,
  CheckboxGroup,
  Collection,
  ComboBox,
  Header,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Section,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from "react-aria-components";
import { Tooltip } from "../misc/Tooltip";
import { hid_usage_page_get_ids, hid_usage_get_metadata } from "../hid-usages";
import { useHostLayout } from "../layouts/LayoutContext";
import {
  ANSI_ROWS,
  BASIC_TIER_HID_IDS,
  type BasicCell,
  ISO_ROWS,
  JIS_ROWS,
  KO_ROWS,
  SPACER_ID,
} from "../layouts/physical";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import type { BehaviorBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import type { BehaviorTile, BindingTileTab } from "./tiles";
import {
  CONSUMER_MEDIA_IDS,
  CONSUMER_PAGE,
  OTHER_SECTION_ORDER,
  otherSectionTitle,
} from "./other-sections";

const sameBinding = (a: BehaviorBinding, b: BehaviorBinding) =>
  a.behaviorId === b.behaviorId && a.param1 === b.param1 && a.param2 === b.param2;

// One host-adaptive basic-tier tab covers the whole "typing" keycode space,
// rendering the shape that matches the selected host layout:
//   - ansi -> ANSI 60%
//   - iso  -> ISO 60% (adds NUHS / NUBS)
//   - jis  -> JIS 60% (adds ¥ / `\_` / 変換 / 無変換 / かな)
//   - ko   -> KO 60% (adds 한자 / 한영)
// A US-ANSI board has no NUHS/NUBS, so they only appear once an ISO/JIS layout
// is selected; the search box still reaches any key regardless of shape.
const BASIC_TAB_ID = "Basic";
const BASIC_TIER_TABS: ReadonlyArray<string> = [BASIC_TAB_ID];

// Tab identifiers, named once so the magic strings aren't duplicated across the
// categorizer, the tab-order list, the panel renderer, and the modifier-row
// visibility check. The keycode category tabs derive from a usage's metadata
// `category`; FUNCTION_NAV_METADATA_CATEGORY is the spec's longer name we shorten.
const FUNCTION_NAV_TAB = "Function + Nav";
const NUMPAD_TAB = "Numpad";
const APPS_MEDIA_TAB = "Apps/Media/Special";
const INTERNATIONAL_TAB = "International";
const OTHER_TAB = "Other";
const FUNCTION_NAV_METADATA_CATEGORY = "Function + Navigation";

// Standard numeric keypad layout. + and KP Enter are normally 1U×2U and 0
// is 2U×1U on a real numpad; we keep heights uniform and only widen 0 to
// 2U so the bottom row still looks like a numpad.
const NUMPAD_LAYOUT: BasicCell[][] = [
  [{ id: 83 }, { id: 84 }, { id: 85 }, { id: 86 }],
  [{ id: 95 }, { id: 96 }, { id: 97 }, { id: 87 }],
  [{ id: 92 }, { id: 93 }, { id: 94 }, { id: 88 }],
  [{ id: 89 }, { id: 90 }, { id: 91 }],
  [{ id: 98, w: 2 }, { id: 99 }],
];

// Function row laid out in 3 stacks so the tab isn't a single super-wide
// row. Esc sits at top-left where it lives on a real keyboard.
const FUNCTION_LAYOUT: (BasicCell | null)[][] = [
  [{ id: 41 }, { id: 58 }, { id: 59 }, { id: 60 }, { id: 61 }], // Esc F1 F2 F3 F4
  [null,       { id: 62 }, { id: 63 }, { id: 64 }, { id: 65 }], // F5-F8
  [null,       { id: 66 }, { id: 67 }, { id: 68 }, { id: 69 }], // F9-F12
];

// TKL navigation cluster: PrSc/ScLk/Pause, the 2x3 edit block, then the
// inverted-T arrow cluster. `null` cells render as transparent spacers so
// the up arrow centers above left/down/right.
const NAVIGATION_LAYOUT: (BasicCell | null)[][] = [
  [{ id: 70 }, { id: 71 }, { id: 72 }],       // PrSc ScLk Pause
  [{ id: 73 }, { id: 74 }, { id: 75 }],       // Ins Home PgUp
  [{ id: 76 }, { id: 77 }, { id: 78 }],       // Del End  PgDn
  [null,        { id: 82 }, null      ],       //     ↑
  [{ id: 80 }, { id: 81 }, { id: 79 }],       // ←   ↓    →
];

export interface HidUsagePage {
  id: number;
  min?: number;
  max?: number;
}

/**
 * Persistent keycap-style "clear / make-transparent" tiles shown in the key
 * grid on every tab, so toggling a key to None / Transparent (and back, by
 * picking a key) never costs a round trip through the behavior tabs. Each tile
 * renders as a keycap — a blank cap for None, a ▽ cap for Transparent — and
 * switches the whole binding's behavior, so they're modelled as `aria-pressed`
 * toggles rather than part of the key (HID-usage) selection.
 */
export interface ClearTilesConfig {
  tiles: { id: number; label: string; glyph: string }[];
  activeId?: number;
  onSelect: (id: number) => void;
}

export interface HidUsagePickerProps {
  label?: string;
  value?: number;
  usagePages: HidUsagePage[];
  onValueChanged: (value?: number) => void;
  /**
   * When true the picker stays visible but is fully non-interactive and
   * dimmed. Used as a stable placeholder when the current behavior takes no
   * parameters, so switching to/from `&kp` doesn't cause a layout jump.
   */
  disabled?: boolean;
  clearTiles?: ClearTilesConfig;
  /**
   * Whole-binding tile tabs appended to the keycode tab strip (before "Other"),
   * e.g. Mouse / System. Picking a tile sets the entire binding via
   * {@link onSelectBinding} rather than the Normal key. The Normal-slot surface
   * passes these so single-action behaviors are picked the same way a keycode
   * is (issue #16, Step 3); other HidUsagePicker uses omit them.
   */
  extraTabs?: BindingTileTab[];
  /**
   * Rarely-used one-tap "flavor" behaviors (Caps Word / Key Repeat / Grave-
   * Escape) appended into the **Apps/Media/Special** keycode tab (issue #16),
   * each a finished binding set via {@link onSelectBinding}. Other HidUsagePicker
   * uses omit them.
   */
  specialTiles?: BehaviorTile[];
  /** Current full binding, used to highlight the active behavior tile / tab. */
  activeBinding?: BehaviorBinding;
  /** Called with the whole binding when a behavior tile is pressed. */
  onSelectBinding?: (binding: BehaviorBinding) => void;
  /**
   * Restrict the grid to picking a *key* only: the whole-binding affordances
   * (the Mouse / System behavior tabs, the one-tap flavor tiles, and the None /
   * Transparent clear tiles) are disabled. Used while a key-state latch (Sticky
   * Key / Key Toggle) is active, where the grid only chooses the latched key and
   * selecting another behavior would silently drop the latch (issue #16).
   */
  keyOnly?: boolean;
  /**
   * Internal: the grid reports its effective active tab so the outer picker can
   * place the implicit-modifier row (only on the keycode tabs where composing a
   * modified keycode makes sense) and hide it on the behavior tabs.
   */
  onActiveTabChange?: (tab: string) => void;
  /**
   * Inline layout (the Normal-slot surface): the implicit-modifier picker is a
   * compact **row below the grid** (shown only on the Basic / Function + Nav
   * tabs) instead of a side column, and the grid's "Key" header + search box are
   * suppressed so the parent can host the search on its own header row. Requires
   * controlled {@link search} / {@link onSearchChange}. Other uses omit this and
   * keep the side column + built-in search.
   */
  inline?: boolean;
  /** Controlled search text (inline mode); the parent renders the input. */
  search?: string;
  /** Controlled search setter (inline mode). */
  onSearchChange?: (search: string) => void;
  /**
   * Customise the implicit-modifier picker (which bakes modifiers into the
   * picked keycode, e.g. C + L Ctrl → `LC(C)` = Ctrl+C in one keypress). Defaults
   * to the "+ Modifier" side column; the Normal slot passes `label: "+ Send with"`.
   */
  modifiers?: {
    side?: "left" | "right";
    label?: string;
    hint?: string;
  };
}

enum Mods {
  LeftControl = 0x01,
  LeftShift = 0x02,
  LeftAlt = 0x04,
  LeftGUI = 0x08,
  RightControl = 0x10,
  RightShift = 0x20,
  RightAlt = 0x40,
  RightGUI = 0x80,
}

const mod_labels: Record<Mods, string> = {
  [Mods.LeftControl]: "L Ctrl",
  [Mods.LeftShift]: "L Shift",
  [Mods.LeftAlt]: "L Alt",
  [Mods.LeftGUI]: "L GUI",
  [Mods.RightControl]: "R Ctrl",
  [Mods.RightShift]: "R Shift",
  [Mods.RightAlt]: "R Alt",
  [Mods.RightGUI]: "R GUI",
};

const all_mods = [
  Mods.LeftControl,
  Mods.LeftShift,
  Mods.LeftAlt,
  Mods.LeftGUI,
  Mods.RightControl,
  Mods.RightShift,
  Mods.RightAlt,
  Mods.RightGUI,
];

function mods_to_flags(mods: Mods[]): number {
  return mods.reduce((a, v) => a + v, 0);
}

function mask_mods(value: number) {
  return value & ~(mods_to_flags(all_mods) << 24);
}

const HidUsageGrid = ({
  value,
  onValueChanged,
  usagePages,
  clearTiles,
  extraTabs,
  specialTiles,
  activeBinding,
  onSelectBinding,
  keyOnly,
  onActiveTabChange,
  inline,
  search: controlledSearch,
  onSearchChange,
}: HidUsagePickerProps) => {
  const layout = useHostLayout();
  type Usage = {
    Name: string;
    Id: number;
    pageName: string;
    pageId: number;
  };
  const allUsages = useMemo(() => {
    return usagePages.flatMap((page) => {
      const pageInfo = hid_usage_page_get_ids(page.id);
      if (!pageInfo) {
        return [];
      }

      let usages = pageInfo.UsageIds || [];
      if (page.max || page.min) {
        usages = usages.filter(
          (i) =>
            (i.Id <= (page.max || Number.MAX_SAFE_INTEGER) &&
              i.Id >= (page.min || 0)) ||
            (page.id === 7 && i.Id >= 0xe0 && i.Id <= 0xe7),
        );
      }

      return usages.map((usage) => ({
        ...usage,
        pageId: page.id,
        pageName: pageInfo.Name,
      }));
    });
  }, [usagePages]);

  const selectedKey = value !== undefined ? mask_mods(value) : null;

  const getButtonLabel = (usage: Usage, opts?: { preferShort?: boolean }) => {
    const metadata = hid_usage_get_metadata(usage.pageId, usage.Id, layout);
    if (opts?.preferShort && metadata?.short) {
      return metadata.short;
    }
    if (metadata?.med) {
      return metadata.med;
    }
    if (metadata?.short) {
      return metadata.short;
    }

    if (usage.pageName === "Keyboard/Keypad") {
      const match = usage.Name.match(/^(Keyboard|Keypad) (\S+)/);
      if (match && match[2]) {
        return match[2];
      }
    }
    return usage.Name;
  };

  const categorizedUsages = useMemo(() => {
    const categories: Record<string, Usage[]> = {};

    for (const usage of allUsages) {
      const metadata = hid_usage_get_metadata(usage.pageId, usage.Id, layout);
      let category = metadata?.category || OTHER_TAB;
      // The spec's "Function + Navigation" category covers the TKL function row
      // + navigation cluster + arrows. We keep them in one tab — they share
      // screen real estate cleanly without scrolling.
      if (category === FUNCTION_NAV_METADATA_CATEGORY) {
        category = FUNCTION_NAV_TAB;
      }
      // Promote the common consumer media keys out of the Other catch-all.
      if (usage.pageId === CONSUMER_PAGE && CONSUMER_MEDIA_IDS.has(usage.Id)) {
        category = APPS_MEDIA_TAB;
      }
      // Letters / Numbers + Punctuation always land on a basic-tier tab
      // (rendered explicitly per shape, no flat-list fallback needed) so
      // they shouldn't appear under their original metadata category.
      if (category === "Letters" || category === "Numbers + Punctuation") {
        continue;
      }
      // Anything on a basic-tier shape (Tab / Caps / mods / Space / etc.,
      // plus ISO NUHS/NUBS and JIS ¥/IME extras) is handled by the single
      // host-adaptive Basic tab's explicit grid — drop from category tabs so
      // it doesn't surface twice and the auto-jump doesn't prefer a stale
      // duplicate.
      if (usage.pageId === 7 && BASIC_TIER_HID_IDS.has(usage.Id)) {
        continue;
      }

      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category].push(usage);
    }

    return categories;
  }, [allUsages, layout]);

  // Group the Other catch-all into labelled sections for the combobox.
  const otherSections = useMemo(() => {
    const groups = new Map<string, Usage[]>();
    for (const u of categorizedUsages[OTHER_TAB] ?? []) {
      const title = otherSectionTitle(u.Name, u.pageId);
      const bucket = groups.get(title);
      if (bucket) bucket.push(u);
      else groups.set(title, [u]);
    }
    return [...groups.entries()]
      .sort(
        (a, b) =>
          OTHER_SECTION_ORDER.indexOf(a[0] as (typeof OTHER_SECTION_ORDER)[number]) -
          OTHER_SECTION_ORDER.indexOf(b[0] as (typeof OTHER_SECTION_ORDER)[number])
      )
      .map(([name, items]) => ({ name, items }));
  }, [categorizedUsages]);

  // null usage = transparent spacer cell (Enter-spans-rows placeholder).
  type ShapeRowItem = { usage: Usage | null; w?: number };

  const buildShapeRows = useCallback(
    (rows: ReadonlyArray<ReadonlyArray<BasicCell>>): ShapeRowItem[][] => {
      const byHidId = new Map<number, Usage>();
      for (const u of allUsages) {
        if (u.pageId === 7) byHidId.set(u.Id, u);
      }
      return rows.map((row) => {
        const built: ShapeRowItem[] = [];
        for (const cell of row) {
          if (cell.id === SPACER_ID) {
            built.push({ usage: null, w: cell.w });
            continue;
          }
          const u = byHidId.get(cell.id);
          if (u) built.push({ usage: u, w: cell.w });
        }
        return built;
      });
    },
    [allUsages]
  );

  // The single Basic tab's shape follows the active host layout's `physical`
  // hint so the picker mirrors the user's actual keyboard:
  //   - ANSI -> ANSI shape (no NUHS / NUBS — the board doesn't have them)
  //   - ISO  -> ISO shape (adds NUHS / NUBS)
  //   - JIS  -> Japanese shape with ¥, `\_`, 無変換, 変換, かな
  //   - KO   -> Korean shape with 한자 / 한/영 flanking Space
  const basicShape = useMemo(() => {
    switch (layout.physical) {
      case "jis": return JIS_ROWS;
      case "ko":  return KO_ROWS;
      case "iso": return ISO_ROWS;
      default:    return ANSI_ROWS;
    }
  }, [layout.physical]);
  const basicRows = useMemo(
    () => buildShapeRows(basicShape),
    [buildShapeRows, basicShape]
  );

  const UNIT_PX = 48;
  // HID IDs whose "short" label (e.g. "Shft", "Ctrl") loses the L/R
  // distinction. Use the metadata "med" label instead so the keycap reads
  // as "L Shft" / "R Shft" / "CapsLk" etc.
  const BASIC_PREFER_MED = new Set([
    57,                               // Caps Lock
    224, 225, 226, 227,               // Left  mods (Ctrl/Shft/Alt/GUI)
    228, 229, 230, 231,               // Right mods (Ctrl/Shft/Alt/GUI)
  ]);

  const numpadRows = useMemo(() => {
    const byHidId = new Map<number, Usage>();
    for (const u of allUsages) {
      if (u.pageId === 7) {
        byHidId.set(u.Id, u);
      }
    }
    const placed = new Set<Usage>();
    const rows = NUMPAD_LAYOUT.map((row) => {
      const out: { usage: Usage; w?: number }[] = [];
      for (const cell of row) {
        const u = byHidId.get(cell.id);
        if (u) {
          out.push({ usage: u, w: cell.w });
          placed.add(u);
        }
      }
      return out;
    });
    const extras = (categorizedUsages[NUMPAD_TAB] || []).filter(
      (u) => !placed.has(u)
    );
    if (extras.length) {
      rows.push(extras.map((u) => ({ usage: u })));
    }
    return rows;
  }, [allUsages, categorizedUsages]);

  // For the merged Function tab we render two layouts side-by-side. The
  // layouts together cover every Function-category HID we care about, so
  // we don't bother surfacing leftovers.
  const { functionRows, navigationRows } = useMemo(() => {
    const byHidId = new Map<number, Usage>();
    for (const u of allUsages) {
      if (u.pageId === 7) {
        byHidId.set(u.Id, u);
      }
    }
    const renderRow = (row: (BasicCell | null)[]) => {
      const out: ({ usage: Usage; w?: number } | null)[] = [];
      for (const cell of row) {
        if (cell === null) {
          out.push(null);
          continue;
        }
        const u = byHidId.get(cell.id);
        if (u) {
          out.push({ usage: u, w: cell.w });
        }
      }
      return out;
    };
    return {
      functionRows: FUNCTION_LAYOUT.map(renderRow),
      navigationRows: NAVIGATION_LAYOUT.map(renderRow),
    };
  }, [allUsages]);
  const cellWidthPx = (w?: number) =>
    (w ?? 1) * UNIT_PX + ((w ?? 1) - 1) * 4; // include the absorbed gap

  const renderBasicButton = ({ usage, w }: { usage: Usage; w?: number }) => {
    const usageValue = (usage.pageId << 16) | usage.Id;
    const preferShort =
      !(usage.pageId === 7 && BASIC_PREFER_MED.has(usage.Id));
    const label = getButtonLabel(usage, { preferShort });
    const pair = label.match(/^(\S{1,2}) (\S{1,2})$/);
    const metadata = hid_usage_get_metadata(usage.pageId, usage.Id, layout);
    // Browser tooltip carries the long-form identity: handy for keys like
    // 変換 / 無変換 / かな where the on-cap label is the Japanese name but
    // the user might recognise the HID identity (Int4 / Int5 / Lang1).
    const tooltip = metadata.long || metadata.med || usage.Name;
    const width = cellWidthPx(w);
    return (
      <Tooltip key={usageValue} label={tooltip}>
        <Button
          onPress={() => onValueChanged(usageValue)}
          style={{ width: `${width}px` }}
          className={`h-12 p-0.5 rounded border text-center flex items-center justify-center text-sm leading-none shrink-0 ${selectedKey === usageValue ? "bg-primary text-primary-content" : "bg-base-200 hover:bg-base-300"}`}
        >
          {pair ? (
            <span className="flex flex-col items-center gap-px">
              <span className="text-[0.65em] opacity-70">{pair[2]}</span>
              <span>{pair[1]}</span>
            </span>
          ) : (
            label
          )}
        </Button>
      </Tooltip>
    );
  };

  // Renders one item from a shape row — either a real key button or a
  // transparent spacer (e.g. JIS row 2's Enter-spans-rows placeholder).
  const renderBasicCell = (item: ShapeRowItem, index: number) => {
    if (item.usage === null) {
      return (
        <div
          key={`spacer-${index}`}
          style={{ width: `${cellWidthPx(item.w)}px` }}
          className="h-12 shrink-0"
          aria-hidden="true"
        />
      );
    }
    return renderBasicButton({ usage: item.usage, w: item.w });
  };

  const sortedCategories = useMemo(() => {
    const categoryOrder = [
      FUNCTION_NAV_TAB,
      NUMPAD_TAB,
      APPS_MEDIA_TAB,
      INTERNATIONAL_TAB,
      OTHER_TAB,
    ];
    return Object.keys(categorizedUsages).sort((a, b) => {
      const indexA = categoryOrder.indexOf(a);
      const indexB = categoryOrder.indexOf(b);
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [categorizedUsages]);

  // Top-level tab order: ANSI basic, ISO/JIS, the keycode category tabs, then
  // the whole-binding behavior tabs (Mouse / System), and "Other" stays last.
  const extraTabNames = useMemo(
    () => (extraTabs ?? []).map((t) => t.name),
    [extraTabs]
  );
  const allTabs = useMemo(() => {
    const cats = sortedCategories.filter((c) => c !== OTHER_TAB);
    const other = sortedCategories.includes(OTHER_TAB) ? [OTHER_TAB] : [];
    return [...BASIC_TIER_TABS, ...cats, ...extraTabNames, ...other];
  }, [sortedCategories, extraTabNames]);

  // Search is controlled in inline mode (the parent hosts the input on its own
  // header row); otherwise the grid owns it and renders its own "Key" header.
  const [internalSearch, setInternalSearch] = useState("");
  const search = onSearchChange ? controlledSearch ?? "" : internalSearch;
  const setSearch = onSearchChange ?? setInternalSearch;
  const trimmedSearch = search.trim().toLowerCase();

  // Auto-select the tab containing the current value when it changes. Every
  // basic-tier key (letters / numbers / mods / shape-specific NUHS / ¥ / IME)
  // lives on the single host-adaptive Basic tab now.
  const [activeTab, setActiveTab] = useState<string | null>(null);
  useEffect(() => {
    if (value === undefined || value === 0) {
      setActiveTab(null);
      return;
    }
    const masked = mask_mods(value);
    const page = (masked >> 16) & 0xffff;
    const usageId = masked & 0xffff;
    if (page === 7 && BASIC_TIER_HID_IDS.has(usageId)) {
      setActiveTab(BASIC_TAB_ID);
      return;
    }
    for (const cat of sortedCategories) {
      const hit = categorizedUsages[cat]?.some(
        (u) => ((u.pageId << 16) | u.Id) === masked
      );
      if (hit) {
        setActiveTab(cat);
        return;
      }
    }
  }, [value, categorizedUsages, sortedCategories]);

  // When the bound behavior is one of the whole-binding tiles (Mouse / System),
  // jump to its tab. Keyed on the binding's *values* (not the object identity)
  // so it only fires when the binding actually changes — otherwise it would snap
  // the tab back to Mouse/System the moment the user clicks a keycode tab to
  // pick a Normal key.
  useEffect(() => {
    if (!activeBinding) return;
    // A flavor behavior (Caps Word / Key Repeat / Grave-Escape) lives in the
    // Apps/Media/Special tab, so jump there when one is the current binding.
    for (const tile of specialTiles ?? []) {
      if (sameBinding(tile.binding, activeBinding)) {
        setActiveTab(APPS_MEDIA_TAB);
        return;
      }
    }
    for (const t of extraTabs ?? []) {
      const hit =
        t.matchFamily?.includes(activeBinding.behaviorId) ||
        t.sections.some((s) =>
          s.tiles.some((tile) => sameBinding(tile.binding, activeBinding))
        );
      if (hit) {
        setActiveTab(t.name);
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeBinding?.behaviorId,
    activeBinding?.param1,
    activeBinding?.param2,
    extraTabs,
    specialTiles,
  ]);

  const onTabChange = useCallback((k: string) => setActiveTab(k), []);

  // Report the effective active tab so the outer picker can make the modifier
  // column tab-aware. `activeTab` is null until a value/binding forces it, so
  // fall back to the tab react-aria actually shows (the Basic tab).
  const effectiveActiveTab = activeTab ?? BASIC_TAB_ID;
  useEffect(() => {
    onActiveTabChange?.(effectiveActiveTab);
  }, [effectiveActiveTab, onActiveTabChange]);

  const searchResults = useMemo(() => {
    if (!trimmedSearch) {
      return null;
    }
    return allUsages.filter((usage) => {
      const metadata = hid_usage_get_metadata(usage.pageId, usage.Id, layout);
      const haystack = [
        usage.Name,
        metadata?.short,
        metadata?.med,
        metadata?.long,
        metadata?.category,
      ]
        .filter((s): s is string => Boolean(s))
        .join(" ")
        .toLowerCase();
      return haystack.includes(trimmedSearch);
    });
  }, [allUsages, trimmedSearch, layout]);

  // The behavior tiles (Mouse / System) live in a separate data shape from the
  // HID usages, so they need their own filter — otherwise a search like "reset"
  // or "bt" finds nothing even though the tile is right there on a tab. Match the
  // tile label, its section heading, and the tab name.
  const behaviorSearchResults = useMemo(() => {
    if (!trimmedSearch) return [];
    const out: BehaviorTile[] = [];
    for (const tile of specialTiles ?? []) {
      if (tile.label.toLowerCase().includes(trimmedSearch)) out.push(tile);
    }
    for (const tab of extraTabs ?? []) {
      for (const section of tab.sections) {
        for (const tile of section.tiles) {
          const haystack = `${tile.label} ${section.heading} ${tab.name}`.toLowerCase();
          if (haystack.includes(trimmedSearch)) out.push(tile);
        }
      }
    }
    return out;
  }, [trimmedSearch, extraTabs, specialTiles]);

  const renderUsageButton = (usage: Usage) => {
    const usageValue = (usage.pageId << 16) | usage.Id;
    return (
      <Button
        key={usageValue}
        onPress={() => onValueChanged(usageValue)}
        className={`w-16 h-16 p-1 rounded border text-center flex items-center justify-center ${selectedKey === usageValue ? "bg-primary text-primary-content" : "bg-base-200 hover:bg-base-300"}`}
      >
        {getButtonLabel(usage)}
      </Button>
    );
  };

  // Keycap-style clear tiles that live among the keys: a blank cap clears the
  // key (None) and a ▽ cap makes it transparent. Picking one reads like picking
  // a key, so it's obvious the binding changed. Each cap matches the size and
  // styling of the keys on the tab it's dropped into ("basic" = 1U shape keys,
  // "usage" = the w-16 flat-list keys), so it never looks like an odd chip.
  const renderClearKeycap = (
    tile: { id: number; label: string; glyph: string },
    variant: "basic" | "usage"
  ) => {
    const active = tile.id === clearTiles!.activeId;
    const fill = active
      ? "bg-primary text-primary-content"
      : "bg-base-200 hover:bg-base-300";
    return (
      <Tooltip key={`clear-${tile.id}`} label={tile.label}>
        <Button
          aria-label={tile.label}
          aria-pressed={active}
          onPress={() => clearTiles!.onSelect(tile.id)}
          style={variant === "basic" ? { width: `${cellWidthPx(1)}px` } : undefined}
          className={
            variant === "basic"
              ? `h-12 p-0.5 rounded border text-center flex items-center justify-center text-base leading-none shrink-0 ${fill}`
              : `w-16 h-16 p-1 rounded border text-center flex items-center justify-center text-xl shrink-0 ${fill}`
          }
        >
          {/* None is intentionally a blank cap (its tooltip says "None"); a
              glyph would read as a specific key. ▽ marks Transparent. */}
          {tile.glyph}
        </Button>
      </Tooltip>
    );
  };

  // Trailing keycaps appended to the end of a key row/list, with a small gap so
  // they read as a distinct "clear" pair rather than another letter key. The
  // variant matches the keys on the tab they're appended to.
  const makeTrailingClearKeycaps = (variant: "basic" | "usage") =>
    clearTiles && clearTiles.tiles.length > 0 ? (
      <>
        <div className="w-4 shrink-0" aria-hidden="true" />
        {clearTiles.tiles.map((tile) => renderClearKeycap(tile, variant))}
      </>
    ) : null;
  const trailingClearKeycapsBasic = makeTrailingClearKeycaps("basic");
  const trailingClearKeycapsUsage = makeTrailingClearKeycaps("usage");

  // A whole-binding behavior tile, styled like a keycap (same height + font as
  // the keycode tiles) so it reads the same as picking a key. Widens for longer
  // labels rather than shrinking the text. It's a single-select "pick the
  // current binding" control, so it's a `radio` (consistent with the residual
  // behavior chips), highlighted when it is the current binding. The label is
  // fully visible, so a native `title` replaces the keycode grid's hover tooltip.
  const renderBehaviorTile = (tile: BehaviorTile, matchFamily?: number[]) => {
    // Highlight on an exact match, or — for a tab with a matchFamily (Layer) —
    // when the active binding is in that family and shares this tile's param
    // (e.g. &sl Fn / &tog Fn light up the To-Layer "Fn" tile).
    const active =
      !!activeBinding &&
      (sameBinding(tile.binding, activeBinding) ||
        (!!matchFamily &&
          matchFamily.includes(activeBinding.behaviorId) &&
          tile.binding.param1 === activeBinding.param1));
    const onPress = () => onSelectBinding?.(tile.binding);
    // While a key latch is active the grid is key-only, so whole-binding tiles
    // are disabled — except a latch *target* family (the Layer tab, which carries
    // matchFamily): a layer is a valid thing to latch, so it stays pickable.
    const disabled = keyOnly && !matchFamily;
    return (
      <button
        key={`${tile.binding.behaviorId}-${tile.binding.param1}-${tile.binding.param2}`}
        type="button"
        role="radio"
        aria-checked={active}
        disabled={disabled}
        title={tile.label}
        onClick={onPress}
        className={`min-w-16 h-16 px-2 whitespace-nowrap rounded border text-center flex items-center justify-center leading-tight shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${active ? "bg-primary text-primary-content" : "bg-base-200 hover:bg-base-300"}`}
      >
        {tile.label}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-1">
      {/* In inline mode the parent hosts the "Key" label + search on its own
          header row, so the grid renders none of its own here. */}
      {!inline && (
        <div className="h-8 flex flex-row items-center gap-2">
          <Label className="text-sm uppercase tracking-widest font-bold text-primary shrink-0">
            Key
          </Label>
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
      )}
      {searchResults !== null ? (
        <div
          aria-label="Search results"
          className="min-h-56 max-h-56 overflow-y-auto flex flex-wrap justify-start content-start gap-1 p-1 border rounded"
        >
          {searchResults.length === 0 && behaviorSearchResults.length === 0 ? (
            <div className="p-2 text-base-content/60 w-full">
              Nothing matches "{search}".
            </div>
          ) : (
            <>
              {searchResults.map(renderUsageButton)}
              {/* Matching behavior tiles (Reset, BT_SEL, LCLK, …) so the search
                  reaches the whole surface, not just the keycodes. Grouped as a
                  radiogroup (own row) since the tiles are radios. */}
              {!keyOnly && behaviorSearchResults.length > 0 && (
                <div
                  role="radiogroup"
                  aria-label="Matching behaviors"
                  className="flex flex-wrap gap-1 basis-full"
                >
                  {behaviorSearchResults.map((t) => renderBehaviorTile(t))}
                </div>
              )}
            </>
          )}
          {/* Keep the clear tiles reachable even when the search matches
              nothing, so a key can still be cleared mid-search. */}
          {trailingClearKeycapsUsage}
        </div>
      ) : (
    <Tabs
      className="flex flex-col"
      selectedKey={activeTab ?? BASIC_TAB_ID}
      onSelectionChange={(k) => onTabChange(k as string)}
      disabledKeys={
        keyOnly
          ? (extraTabs ?? []).filter((t) => !t.matchFamily).map((t) => t.name)
          : []
      }
    >
      <TabList className="flex border-b">
        {allTabs.map((category) => (
          <Tab
            key={category}
            id={category}
            className="px-4 pb-2 cursor-default outline-none rac-selected:border-b-2 rac-selected:border-primary rac-focus-visible:ring-2 rac-focus-visible:ring-primary rac-disabled:opacity-40 rac-disabled:cursor-not-allowed rounded-t-md"
          >
            {category}
          </Tab>
        ))}
      </TabList>
      {allTabs
        .filter((category) => !extraTabNames.includes(category))
        .map((category) => (
        <TabPanel
          key={category}
          id={category}
          className={
            // Unified height across all tabs so switching tabs doesn't
            // shift the rest of the picker. Sized to fit the 5-row
            // basic-tier shapes (ANSI / ISO / JIS all 5 rows tall).
            category === BASIC_TAB_ID ||
            category === NUMPAD_TAB ||
            category === FUNCTION_NAV_TAB
              ? "min-h-[17rem] max-h-[17rem] overflow-auto p-1 border border-t-0 rounded-b rac-focus-visible:ring-2 rac-focus-visible:ring-primary"
              : "min-h-[17rem] max-h-[17rem] overflow-y-auto flex flex-wrap justify-start content-start gap-1 p-1 border border-t-0 rounded-b rac-focus-visible:ring-2 rac-focus-visible:ring-primary"
          }
        >
          {category === BASIC_TAB_ID ? (
            <div className="flex gap-2 w-fit items-stretch">
              <div className="flex flex-col gap-1 w-fit">
                {basicRows.map((row, i) => (
                  <div key={i} className="flex gap-1 items-end">
                    {row.map((cell, j) => renderBasicCell(cell, j))}
                  </div>
                ))}
              </div>
              {/* Right block: the special None / Transparent caps, pinned to the
                  bottom row (mt-auto), aligned with the board's last row. */}
              {clearTiles && clearTiles.tiles.length > 0 && (
                <div className="flex flex-col gap-1 pl-2 border-l border-base-300">
                  <div className="grid grid-cols-2 gap-1 w-fit mt-auto">
                    {clearTiles.tiles.map((tile) =>
                      renderClearKeycap(tile, "basic")
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : category === NUMPAD_TAB ? (
            <div className="flex flex-col gap-1 w-fit">
              {numpadRows.map((row, i) => (
                <div key={i} className="flex gap-1 items-end">
                  {row.map(renderBasicButton)}
                  {i === numpadRows.length - 1 && trailingClearKeycapsBasic}
                </div>
              ))}
            </div>
          ) : category === FUNCTION_NAV_TAB ? (
            <div className="flex flex-row gap-6 w-fit">
              <div className="flex flex-col gap-1">
                {functionRows.map((row, i) => (
                  <div key={i} className="flex gap-1">
                    {row.map((cell, j) =>
                      cell ? (
                        renderBasicButton(cell)
                      ) : (
                        <div key={`gap-${j}`} className="w-12 h-12 shrink-0" />
                      )
                    )}
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-1">
                {navigationRows.map((row, i) => (
                  <div key={i} className="flex gap-1">
                    {row.map((cell, j) =>
                      cell ? (
                        renderBasicButton(cell)
                      ) : (
                        <div key={`gap-${j}`} className="w-12 h-12 shrink-0" />
                      )
                    )}
                  </div>
                ))}
              </div>
              {trailingClearKeycapsBasic && (
                <div className="flex flex-row gap-1 items-end">
                  {trailingClearKeycapsBasic}
                </div>
              )}
            </div>
          ) : category === OTHER_TAB ? (
            <ComboBox
              className="w-full p-2"
              defaultItems={otherSections}
              selectedKey={selectedKey}
              onSelectionChange={(key) =>
                key !== null && onValueChanged(key as number)
              }
            >
              <Label className="text-sm">Search for another key</Label>
              <div className="relative flex items-center">
                <Input className="p-1 rounded-l" />
                <Button className="rounded-r bg-primary text-primary-content w-8 h-8 flex justify-center items-center">
                  <ChevronDown className="size-4" />
                </Button>
              </div>
              <Popover className="w-[var(--trigger-width)] max-h-4 shadow-md text-base-content rounded border-base-content bg-base-100">
                <ListBox className="block max-h-[30vh] min-h-[unset] overflow-auto p-2">
                  {(section: { name: string; items: Usage[] }) => (
                    <Section id={section.name}>
                      <Header className="px-2 pt-2 pb-1 mt-1 text-sm uppercase tracking-wide font-bold text-primary border-t border-base-300">
                        {section.name}
                      </Header>
                      <Collection items={section.items}>
                        {(item: Usage) => {
                          const usageValue = (item.pageId << 16) | item.Id;
                          return (
                            <ListBoxItem
                              id={usageValue}
                              textValue={item.Name}
                              className="rac-hover:bg-base-300 pl-3 relative rac-focus:bg-base-300 cursor-default select-none rac-selected:before:content-['✔'] before:absolute before:left-[0] before:top-[0]"
                            >
                              {item.Name}
                            </ListBoxItem>
                          );
                        }}
                      </Collection>
                    </Section>
                  )}
                </ListBox>
              </Popover>
            </ComboBox>
          ) : (
            <>
              {categorizedUsages[category].map(renderUsageButton)}
              {/* The rarely-used flavor behaviors (Caps Word / Key Repeat /
                  Grave-Escape) live here, on their own row after the media keys. */}
              {category === APPS_MEDIA_TAB &&
                specialTiles &&
                specialTiles.length > 0 && (
                  <div
                    role="radiogroup"
                    aria-label="Behaviors"
                    className="flex flex-wrap gap-1 basis-full"
                  >
                    {specialTiles.map((t) => renderBehaviorTile(t))}
                  </div>
                )}
              {trailingClearKeycapsUsage}
            </>
          )}
        </TabPanel>
      ))}
      {/* Whole-binding behavior tabs (Mouse / System): keycap-styled tiles, one
          labelled section per source behavior, each tile a finished binding. */}
      {extraTabs?.map((tab) => (
        <TabPanel
          key={tab.name}
          id={tab.name}
          className="min-h-[17rem] max-h-[17rem] overflow-y-auto flex flex-col gap-3 p-1 border border-t-0 rounded-b rac-focus-visible:ring-2 rac-focus-visible:ring-primary"
        >
          {tab.sections.map((section) => (
            <div key={section.heading} className="flex flex-col gap-1">
              <span className="text-sm uppercase tracking-wide font-semibold text-base-content/70">
                {section.heading}
              </span>
              <div
                role="radiogroup"
                aria-label={section.heading}
                className="flex flex-wrap gap-1"
              >
                {section.tiles.map((t) =>
                  renderBehaviorTile(t, tab.matchFamily)
                )}
              </div>
            </div>
          ))}
        </TabPanel>
      ))}
    </Tabs>
      )}
    </div>
  );
};

export const HidUsagePicker = ({
  label,
  value,
  usagePages,
  onValueChanged,
  disabled,
  clearTiles,
  extraTabs,
  specialTiles,
  activeBinding,
  onSelectBinding,
  keyOnly,
  inline,
  search,
  onSearchChange,
  modifiers,
}: HidUsagePickerProps) => {
  const modSide = modifiers?.side ?? "left";
  const modLabel = modifiers?.label ?? "+ Modifier";

  // Track the grid's active tab so the implicit-modifier picker can be shown
  // only where it makes sense (keycode tabs) and hidden on the behavior tabs.
  const [activeTabName, setActiveTabName] = useState<string>(BASIC_TAB_ID);
  const behaviorTabNames = useMemo(
    () => (extraTabs ?? []).map((t) => t.name),
    [extraTabs]
  );
  const onBehaviorTab = behaviorTabNames.includes(activeTabName);
  // In inline mode the modifier row shows only on the tabs where you actually
  // compose a modified keycode — Basic and Function + Nav — and never while a
  // search is filtering the grid.
  const showModRow =
    !onBehaviorTab &&
    (activeTabName === BASIC_TAB_ID || activeTabName === FUNCTION_NAV_TAB) &&
    !(search && search.trim().length > 0);

  const mods = useMemo(() => {
    const flags = value ? value >> 24 : 0;

    return all_mods.filter((m) => m & flags).map((m) => m.toLocaleString());
  }, [value]);

  const toggleMod = (m: Mods) => {
    const next = new Set(mods);
    const key = m.toLocaleString();
    if (next.has(key)) next.delete(key);
    else next.add(key);
    modifiersChanged([...next]);
  };

  const selectionChanged = useCallback(
    (e: number | undefined) => {
      let value = typeof e == "number" ? e : undefined;
      if (value !== undefined) {
        const mod_flags = mods_to_flags(mods.map((m) => parseInt(m)));
        value = value | (mod_flags << 24);
      }

      onValueChanged(value);
    },
    [onValueChanged, mods],
  );

  const modifiersChanged = useCallback(
    (m: string[]) => {
      if (!value) {
        return;
      }

      const mod_flags = mods_to_flags(m.map((m) => parseInt(m)));
      const new_value = mask_mods(value) | (mod_flags << 24);
      onValueChanged(new_value);
    },
    [value, onValueChanged],
  );

  // Side column (default, non-inline uses such as the Sticky Key / Key Toggle
  // key picker): the implicit modifiers as a vertical checkbox stack.
  const modifierColumn = (
    <div className="flex flex-col gap-1 shrink-0">
      <div className="h-8 flex items-center">
        <Label
          id="hid-usage-picker"
          className="text-sm uppercase tracking-widest font-bold text-primary"
        >
          {modLabel}
        </Label>
      </div>
      <CheckboxGroup
        aria-label={label ? `Implicit modifiers for ${label}` : "Implicit modifiers"}
        className="flex flex-col gap-px rounded-md"
        value={mods}
        onChange={modifiersChanged}
      >
        {all_mods.map((m) => (
          <Checkbox
            key={m}
            value={m.toLocaleString()}
            className="text-nowrap cursor-pointer flex px-3 py-1 items-center rac-selected:bg-primary border-base-100 bg-base-300 hover:bg-base-100 first:rounded-t-md last:rounded-b-md rac-selected:text-primary-content"
          >
            {mod_labels[m]}
          </Checkbox>
        ))}
      </CheckboxGroup>
      {modifiers?.hint && (
        <p className="text-xs text-base-content/60 w-32">{modifiers.hint}</p>
      )}
    </div>
  );

  // Inline row (the Normal-slot surface): a compact "Send with" row of modifier
  // toggles below the full-width grid, so it never steals tab/grid width.
  const modifierRow = (
    <div className="flex items-center flex-wrap gap-1" role="group" aria-label="Send with modifiers">
      <span className="text-sm uppercase tracking-widest font-bold text-primary mr-1">
        {modLabel}
      </span>
      {all_mods.map((m) => {
        const active = mods.includes(m.toLocaleString());
        return (
          <button
            key={m}
            type="button"
            aria-pressed={active}
            onClick={() => toggleMod(m)}
            className={`px-3 py-1 rounded border text-sm ${
              active
                ? "bg-primary text-primary-content border-primary"
                : "bg-base-200 hover:bg-base-300 border-base-300"
            }`}
          >
            {mod_labels[m]}
          </button>
        );
      })}
      {modifiers?.hint && (
        <span className="text-xs text-base-content/50 ml-1">{modifiers.hint}</span>
      )}
    </div>
  );

  const grid = (
    <div className="flex-1 min-w-0">
      <HidUsageGrid
        value={value}
        onValueChanged={selectionChanged}
        usagePages={usagePages}
        clearTiles={clearTiles}
        extraTabs={extraTabs}
        specialTiles={specialTiles}
        activeBinding={activeBinding}
        onSelectBinding={onSelectBinding}
        keyOnly={keyOnly}
        onActiveTabChange={setActiveTabName}
        inline={inline}
        search={search}
        onSearchChange={onSearchChange}
      />
    </div>
  );

  if (inline) {
    return (
      <div
        className={`flex flex-col gap-2 relative ${
          disabled ? "opacity-40 pointer-events-none select-none" : ""
        }`}
        aria-disabled={disabled || undefined}
      >
        {grid}
        {showModRow && modifierRow}
      </div>
    );
  }

  return (
    <div
      className={`flex flex-row gap-3 relative ${
        disabled ? "opacity-40 pointer-events-none select-none" : ""
      }`}
      aria-disabled={disabled || undefined}
    >
      {/* The implicit-modifier column is irrelevant on the whole-binding tabs
          (Mouse / System) — a Reset can't "send with Ctrl" — so hide it there. */}
      {modSide === "right" ? (
        <>
          {grid}
          {!onBehaviorTab && modifierColumn}
        </>
      ) : (
        <>
          {!onBehaviorTab && modifierColumn}
          {grid}
        </>
      )}
    </div>
  );
};
