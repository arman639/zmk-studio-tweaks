import type { TransportFactory } from "../ConnectModal";
import type { AvailableDevice } from "../tauri/index";
import { createLoopbackTransport } from "./loopback";
import { createMockHandler } from "./device";
import { MOCK_FIXTURES } from "./fixtures";

export type { MockKeyboardFixture } from "./device";
export { MOCK_FIXTURES } from "./fixtures";

/**
 * Connect-dialog transport(s) that emulate a keyboard entirely in-memory. Shown
 * in their own dialog (scoped via the hero "Try a demo keyboard" button) so the
 * dummy keyboards never mix with real USB/BLE devices. Each fixture surfaces as
 * one selectable "device".
 */
export const MOCK_TRANSPORTS: TransportFactory[] = [
  {
    label: "Demo",
    pick_and_connect: {
      list: async (): Promise<AvailableDevice[]> =>
        MOCK_FIXTURES.map((f) => ({ id: f.id, label: f.label })),
      connect: async (dev: AvailableDevice) => {
        const fixture =
          MOCK_FIXTURES.find((f) => f.id === dev.id) ?? MOCK_FIXTURES[0];
        return createLoopbackTransport(
          fixture.deviceName,
          createMockHandler(fixture)
        );
      },
    },
  },
];
