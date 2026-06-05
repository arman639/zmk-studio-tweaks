// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConnectModal } from "./ConnectModal";
import { MOCK_TRANSPORTS } from "./mock";

describe("ConnectModal device selection", () => {
  it("connects the picked demo device via onTransportCreated", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onTransportCreated = vi.fn();

    render(
      <ConnectModal
        open
        transports={MOCK_TRANSPORTS}
        onTransportCreated={onTransportCreated}
      />
    );

    const device = await screen.findByRole("option", {
      name: /demo · 50-key ortho/i,
    });
    await user.click(device);

    await vi.waitFor(() => expect(onTransportCreated).toHaveBeenCalledTimes(1));
  });
});
