import { describe, expect, it } from "vitest";
import { call_rpc, create_rpc_connection } from "@zmkfirmware/zmk-studio-ts-client";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import { SetLayerBindingResponse } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import { createLoopbackTransport } from "./loopback";
import { createMockHandler } from "./device";
import { DEMO_ORTHO_50 } from "./fixtures";

// Drives the mock through the *real* RPC stack (create_rpc_connection +
// call_rpc), so this exercises framing, protobuf encode/decode and the handler
// together — exactly the path the connected app takes.
function connectMock() {
  const transport = createLoopbackTransport(
    DEMO_ORTHO_50.deviceName,
    createMockHandler(DEMO_ORTHO_50)
  );
  return create_rpc_connection(transport);
}

describe("mock device over the real RPC stack", () => {
  it("reports device info and an unlocked state", async () => {
    const conn = connectMock();

    const info = await call_rpc(conn, { core: { getDeviceInfo: true } });
    expect(info.core?.getDeviceInfo?.name).toBe(DEMO_ORTHO_50.deviceName);

    const lock = await call_rpc(conn, { core: { getLockState: true } });
    expect(lock.core?.getLockState).toBe(
      LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED
    );
  });

  it("returns the keymap, physical layout and behaviors", async () => {
    const conn = connectMock();

    const keymap = (await call_rpc(conn, { keymap: { getKeymap: true } })).keymap
      ?.getKeymap;
    expect(keymap?.layers).toHaveLength(2);
    expect(keymap?.layers[0].bindings).toHaveLength(50);

    const layouts = (
      await call_rpc(conn, { keymap: { getPhysicalLayouts: true } })
    ).keymap?.getPhysicalLayouts;
    expect(layouts?.layouts[0].keys).toHaveLength(50);

    const list = (
      await call_rpc(conn, { behaviors: { listAllBehaviors: true } })
    ).behaviors?.listAllBehaviors?.behaviors;
    expect(list && list.length).toBeGreaterThan(0);

    const details = (
      await call_rpc(conn, {
        behaviors: { getBehaviorDetails: { behaviorId: list![0] } },
      })
    ).behaviors?.getBehaviorDetails;
    expect(details?.displayName).toBe("Key Press");
  });

  it("persists an edited binding for subsequent reads", async () => {
    const conn = connectMock();

    const before = (await call_rpc(conn, { keymap: { getKeymap: true } })).keymap
      ?.getKeymap;
    const layerId = before!.layers[0].id;
    const newBinding = { behaviorId: 5, param1: 0, param2: 0 }; // None

    const set = await call_rpc(conn, {
      keymap: {
        setLayerBinding: { layerId, keyPosition: 0, binding: newBinding },
      },
    });
    expect(set.keymap?.setLayerBinding).toBe(
      SetLayerBindingResponse.SET_LAYER_BINDING_RESP_OK
    );

    const after = (await call_rpc(conn, { keymap: { getKeymap: true } })).keymap
      ?.getKeymap;
    expect(after!.layers[0].bindings[0]).toEqual(newBinding);
  });

  it("pushes an unsavedChangesStatusChanged notification on edit", async () => {
    const conn = connectMock();
    const notifications = conn.notification_readable.getReader();

    const layerId = (await call_rpc(conn, { keymap: { getKeymap: true } })).keymap
      ?.getKeymap?.layers[0].id;
    await call_rpc(conn, {
      keymap: {
        setLayerBinding: {
          layerId: layerId!,
          keyPosition: 0,
          binding: { behaviorId: 5, param1: 0, param2: 0 },
        },
      },
    });

    const note = await notifications.read();
    expect(note.value?.keymap?.unsavedChangesStatusChanged).toBe(true);
  });

  it("reverts edited bindings on discardChanges", async () => {
    const conn = connectMock();

    const before = (await call_rpc(conn, { keymap: { getKeymap: true } })).keymap
      ?.getKeymap;
    const layerId = before!.layers[0].id;
    const original = before!.layers[0].bindings[0];

    await call_rpc(conn, {
      keymap: {
        setLayerBinding: {
          layerId,
          keyPosition: 0,
          binding: { behaviorId: 5, param1: 0, param2: 0 },
        },
      },
    });
    await call_rpc(conn, { keymap: { discardChanges: true } });

    const after = (await call_rpc(conn, { keymap: { getKeymap: true } })).keymap
      ?.getKeymap;
    expect(after!.layers[0].bindings[0]).toEqual(original);
  });
});
