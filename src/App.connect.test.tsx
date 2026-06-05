// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "./App";
import { ToastProvider } from "./Toast";
import { HostLayoutProvider } from "./layouts/LayoutContext";

function renderApp() {
  return render(
    <HostLayoutProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </HostLayoutProvider>
  );
}

describe("connecting to the demo device", () => {
  it("enters the connected editor from the hero page", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderApp();

    // Hero page: the demo entry is always available (no hardware needed).
    const demoButton = screen.getByRole("button", {
      name: /try a demo keyboard/i,
    });
    await user.click(demoButton);

    // The connect dialog is scoped to the mock transport and lists the fixture.
    const device = await screen.findByRole("option", {
      name: /demo · 50-key ortho/i,
    });
    await user.click(device);

    // Connected: the demo board's "Base" / "Fn" layers appear as options in the
    // layer list (role="option" pins these to the LayerPicker, not the "Fn"
    // labels that also render on keys bound to the Fn layer).
    const layerList = await screen.findByRole("listbox", {
      name: /keymap layer/i,
    });
    expect(
      await within(layerList).findByRole("option", { name: "Base" })
    ).toBeInTheDocument();
    expect(
      within(layerList).getByRole("option", { name: "Fn" })
    ).toBeInTheDocument();

    // And the hero's marketing copy is gone — we're really in the editor.
    expect(
      screen.queryByText(/a community fork of zmk studio/i)
    ).not.toBeInTheDocument();
  });
});
