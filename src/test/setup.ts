// Vitest global setup. Loaded for every test file; each shim is guarded so it
// only applies in the DOM (happy-dom) test environment and leaves the node-env
// tests (PhysicalLayout, mock, …) untouched.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount React trees between tests (Vitest doesn't auto-register this without
// `globals: true`), so renders don't stack up and duplicate matched elements.
afterEach(() => cleanup());

// The DOM test env has no ResizeObserver; PhysicalLayout observes its parent.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// The DOM env's <dialog> showModal/close may be missing or throw "Not
// implemented"; useModalRef drives the connect/unlock modals through them.
// Replace with minimal versions that just toggle `open` and fire `close`.
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.show = function show() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(returnValue?: string) {
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}

// react-aria drives selection through Pointer events + pointer capture, which
// the DOM env may not implement. Without these, clicking a ListBox option never
// fires onSelectionChange.
if (typeof window !== "undefined" && !window.PointerEvent) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    width: number;
    height: number;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
      this.pointerType = params.pointerType ?? "mouse";
      this.width = params.width ?? 1;
      this.height = params.height ?? 1;
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}
if (typeof Element !== "undefined") {
  Element.prototype.setPointerCapture ??= function setPointerCapture() {};
  Element.prototype.releasePointerCapture ??= function releasePointerCapture() {};
  Element.prototype.hasPointerCapture ??= function hasPointerCapture() {
    return false;
  };
}

// react-aria and lucide occasionally call these; the DOM env may not implement them.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
