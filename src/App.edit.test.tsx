// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "./App";
import { ToastProvider } from "./Toast";
import { HostLayoutProvider } from "./layouts/LayoutContext";

type User = ReturnType<typeof userEvent.setup>;

function renderApp() {
  return render(
    <HostLayoutProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </HostLayoutProvider>
  );
}

async function connectDemo(user: User) {
  renderApp();
  await user.click(
    screen.getByRole("button", { name: /try a demo keyboard/i })
  );
  await user.click(
    await screen.findByRole("option", { name: /demo · 50-key ortho/i })
  );
  await screen.findByRole("listbox", { name: /keymap layer/i });
}

// Select the "Q" key on the base layer and reassign it to None. "None" now
// appears both as a persistent quick tile and as a Basic-group chip, so pick
// the first match rather than asserting a single one.
async function changeQtoNone(user: User) {
  const qKey = (await screen.findAllByRole("button", { name: /\bQ\b/ }))[0];
  await user.click(qKey);
  await user.click((await screen.findAllByRole("radio", { name: "None" }))[0]);
}

describe("editing on the demo device drives the save lifecycle", () => {
  it("lights Save and Discard after an edit", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await connectDemo(user);

    const save = screen.getByRole("button", { name: "Save" });
    const discard = screen.getByRole("button", { name: "Discard" });
    expect(save).toBeDisabled();
    expect(discard).toBeDisabled();

    await changeQtoNone(user);

    await waitFor(() => expect(save).toBeEnabled());
    expect(discard).toBeEnabled();
  });

  it("clears the unsaved state after saving", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await connectDemo(user);
    await changeQtoNone(user);

    const save = screen.getByRole("button", { name: "Save" });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() => expect(save).toBeDisabled());
  });

  it("reverts the edited binding on discard", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await connectDemo(user);

    // Q is on the base layer to begin with.
    expect(
      (await screen.findAllByRole("button", { name: /\bQ\b/ })).length
    ).toBeGreaterThan(0);

    await changeQtoNone(user);

    const discard = screen.getByRole("button", { name: "Discard" });
    await waitFor(() => expect(discard).toBeEnabled());
    await user.click(discard);

    // Discarding restores the original Key Press Q binding (and closes the
    // picker, so only the keymap's Q remains). Re-query each poll so the
    // post-discard re-fetch re-render doesn't hand back a detached node.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /\bQ\b/ })
      ).toBeInTheDocument()
    );
  });
});

describe("persistent clear tiles (key-picker rethink, step 1)", () => {
  it("keeps None and Transparent reachable while editing a key", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await connectDemo(user);

    const qKey = (await screen.findAllByRole("button", { name: /\bQ\b/ }))[0];
    await user.click(qKey);

    // Both clear tiles are present without switching the behavior tabs.
    expect(
      (await screen.findAllByRole("radio", { name: "None" })).length
    ).toBeGreaterThan(0);
    expect(
      (await screen.findAllByRole("radio", { name: "Transparent" })).length
    ).toBeGreaterThan(0);
  });

  it("returns a None'd key to Key Press in one grid click", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await connectDemo(user);
    await changeQtoNone(user);

    // With Q set to None its keymap tile no longer reads "Q", so the only
    // remaining "Q" button is the live keycode grid's tile. Clicking it must
    // promote the binding straight back to Key Press (no tab round trip).
    const gridQ = await screen.findAllByRole("button", { name: /\bQ\b/ });
    await user.click(gridQ[gridQ.length - 1]);

    await waitFor(() =>
      expect(
        screen
          .getAllByRole("radio", { name: "Key Press" })
          .some((r) => r.getAttribute("aria-checked") === "true")
      ).toBe(true)
    );
  });
});
