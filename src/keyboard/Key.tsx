import { PropsWithChildren } from "react";
import BehaviorShortNames from "./behavior-short-names.json";

interface KeyProps {
  selected?: boolean;
  width: number;
  height: number;
  oneU: number;
  header?: string;
  /** When false the binding has no parameter, so the header is the key's whole
   * legend (None / Transparent / Caps Word / Reset / …) and is rendered centred
   * like a keycode rather than as a badge pill. */
  hasParam?: boolean;
  onClick?: () => void;
}

interface BehaviorShortName {
  short?: string;
}

const MAX_HEADER_LENGTH = 9;
const shortNames: Record<string, BehaviorShortName> = BehaviorShortNames;

const shortenHeader = (header: string | undefined) => {
  if(typeof header === "undefined"){
    return "";
  }
  // Empty string is a valid header for behaviors where we don't want to see a header, which is falsy
  // So we use an undefined check here
  if(typeof shortNames[header]?.short !== "undefined"){
    return shortNames[header].short;
  } else if(header.length > MAX_HEADER_LENGTH){
    const words = header.split(/[\s,-]+/);
    const lettersPerWord = Math.trunc(MAX_HEADER_LENGTH / words.length);
    return words.map((word) => (word.substring(0,lettersPerWord))).join("");
  } else {
    return header;
  }
}

export const Key = ({
  selected = false,
  width,
  height,
  oneU,
  header,
  hasParam = true,
  onClick,
  children,
}: PropsWithChildren<KeyProps>) => {
  const pixelWidth = width * oneU - 2;
  const pixelHeight = height * oneU - 2;

  const shortHeader = shortenHeader(header);
  // A paramless behavior's name *is* the legend: centre it like a keycode rather
  // than as a badge pill above an (empty) value, so a None / Transparent / Caps
  // Word / Reset key reads as just another key.
  const headerIsLegend = !hasParam && !!shortHeader;
  const showPill = !!shortHeader && !headerIsLegend;
  return (
    <button
      className={`group rounded relative flex justify-center items-center cursor-pointer transition-colors hover:ring-1 hover:ring-gray-300 ${selected ? "bg-primary text-primary-content" : "bg-base-100 text-base-content"
        }`}
      style={{
        width: `${pixelWidth}px`,
        height: `${pixelHeight}px`,
      }}
      onClick={onClick}
    >
      {showPill && (
        <div
          className={`absolute top-0.5 left-1/2 -translate-x-1/2 text-xs leading-none font-bold px-1 py-0 rounded-md border text-nowrap truncate max-w-[96%] ${
            selected
              ? "border-primary-content/50 bg-primary-content/15 text-primary-content"
              : "border-base-content/30 bg-base-content/10 text-base-content"
          }`}
        >
          {shortHeader}
        </div>
      )}
      <div
        className={`absolute inset-0 flex justify-center ${
          showPill ? "items-start pt-3" : "items-center"
        }`}
      >
        {headerIsLegend ? (
          // A single glyph (e.g. Transparent's ▽) reads at a normal size; a
          // multi-letter behavior name is set smaller than a keycode legend so it
          // never competes with a plain letter key. (None resolves to "" — a
          // deliberately blank cap — so it isn't a legend at all.)
          <span
            className={`${
              shortHeader.length <= 1 ? "text-base" : "text-xs"
            } leading-tight text-center px-0.5 break-words max-w-full`}
          >
            {shortHeader}
          </span>
        ) : (
          children
        )}
      </div>
    </button>
  );
};
