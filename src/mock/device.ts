import { Request, Response } from "@zmkfirmware/zmk-studio-ts-client";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import {
  AddLayerErrorCode,
  Keymap,
  Layer,
  PhysicalLayout,
  RemoveLayerErrorCode,
  RestoreLayerErrorCode,
  SetActivePhysicalLayoutErrorCode,
  SetLayerBindingResponse,
  SetLayerPropsResponse,
} from "@zmkfirmware/zmk-studio-ts-client/keymap";
import type { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import type { RpcHandler } from "./loopback";

/**
 * A self-contained description of a virtual keyboard the mock transport can
 * emulate. This is the fork-local, device-aware half of the mock: hand-authored
 * (or, ideally, seeded from a real device dump — see issue #17) so the picker
 * can be exercised against behaviour shapes we may not physically own.
 */
export interface MockKeyboardFixture {
  /** Stable id used as the `AvailableDevice` id in the connect dialog. */
  id: string;
  /** Label shown in the connect dialog's device list. */
  label: string;
  /** Reported by `core.getDeviceInfo`. */
  deviceName: string;
  serialNumber?: string;
  behaviors: GetBehaviorDetailsResponse[];
  physicalLayouts: PhysicalLayout[];
  activeLayoutIndex: number;
  layers: Layer[];
  /** Total layer slots; `availableLayers = maxLayers - layers.length`. */
  maxLayers: number;
  maxLayerNameLength: number;
}

const clone = <T>(value: T): T =>
  typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));

/**
 * Builds an {@link RpcHandler} backed by an in-memory copy of `fixture`. Each
 * connection deep-clones the fixture so demo edits start fresh and never leak
 * back into the shared definition.
 *
 * Only the requests the app actually issues are answered; anything else falls
 * through to a bare request/response so `call_rpc` resolves rather than hangs.
 */
export function createMockHandler(fixture: MockKeyboardFixture): RpcHandler {
  const layers: Layer[] = clone(fixture.layers);
  let activeLayoutIndex = fixture.activeLayoutIndex;
  let unsavedChanges = false;
  // Layers removed this session, kept so `restoreLayer` (undo of a remove) can
  // put the exact same layer back.
  const removed = new Map<number, Layer>();

  const transparentBehaviorId =
    fixture.behaviors.find((b) => b.displayName === "Transparent")?.id ?? 0;

  const keymap = (): Keymap => ({
    layers,
    availableLayers: Math.max(0, fixture.maxLayers - layers.length),
    maxLayerNameLength: fixture.maxLayerNameLength,
  });

  const nextLayerId = () =>
    layers.reduce((max, l) => Math.max(max, l.id), 0) + 1;

  return (request: Request): Response => {
    const requestId = request.requestId;

    if (request.core) {
      const core = request.core;
      if (core.getDeviceInfo) {
        return resp(requestId, {
          core: {
            getDeviceInfo: {
              name: fixture.deviceName,
              serialNumber: new TextEncoder().encode(
                fixture.serialNumber ?? fixture.id
              ),
            },
          },
        });
      }
      if (core.getLockState) {
        // Start unlocked: a demo has nothing to protect, and requiring a
        // physical key press would be impossible without hardware.
        return resp(requestId, {
          core: { getLockState: LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED },
        });
      }
      if (core.resetSettings) {
        return resp(requestId, { core: { resetSettings: true } });
      }
    }

    if (request.behaviors) {
      const b = request.behaviors;
      if (b.listAllBehaviors) {
        return resp(requestId, {
          behaviors: {
            listAllBehaviors: { behaviors: fixture.behaviors.map((x) => x.id) },
          },
        });
      }
      if (b.getBehaviorDetails) {
        const id = b.getBehaviorDetails.behaviorId;
        const details = fixture.behaviors.find((x) => x.id === id);
        if (details) {
          return resp(requestId, {
            behaviors: { getBehaviorDetails: details },
          });
        }
      }
    }

    if (request.keymap) {
      const k = request.keymap;

      if (k.getKeymap) {
        return resp(requestId, { keymap: { getKeymap: keymap() } });
      }

      if (k.getPhysicalLayouts) {
        return resp(requestId, {
          keymap: {
            getPhysicalLayouts: {
              activeLayoutIndex,
              layouts: fixture.physicalLayouts,
            },
          },
        });
      }

      if (k.setActivePhysicalLayout !== undefined) {
        const index = k.setActivePhysicalLayout;
        if (index < 0 || index >= fixture.physicalLayouts.length) {
          return resp(requestId, {
            keymap: {
              setActivePhysicalLayout: {
                err: SetActivePhysicalLayoutErrorCode.SET_ACTIVE_PHYSICAL_LAYOUT_ERR_INVALID_LAYOUT_INDEX,
              },
            },
          });
        }
        activeLayoutIndex = index;
        // Switching the active physical layout is a persisted setting, so mark
        // the keymap dirty to match real firmware (lights the Save indicator).
        unsavedChanges = true;
        return resp(requestId, {
          keymap: { setActivePhysicalLayout: { ok: keymap() } },
        });
      }

      if (k.setLayerBinding) {
        const { layerId, keyPosition, binding } = k.setLayerBinding;
        const layer = layers.find((l) => l.id === layerId);
        if (!layer || keyPosition < 0 || keyPosition >= layer.bindings.length) {
          return resp(requestId, {
            keymap: {
              setLayerBinding:
                SetLayerBindingResponse.SET_LAYER_BINDING_RESP_INVALID_LOCATION,
            },
          });
        }
        if (binding) {
          layer.bindings[keyPosition] = binding;
          unsavedChanges = true;
        }
        return resp(requestId, {
          keymap: {
            setLayerBinding: SetLayerBindingResponse.SET_LAYER_BINDING_RESP_OK,
          },
        });
      }

      if (k.checkUnsavedChanges) {
        return resp(requestId, {
          keymap: { checkUnsavedChanges: unsavedChanges },
        });
      }

      if (k.saveChanges) {
        unsavedChanges = false;
        return resp(requestId, { keymap: { saveChanges: { ok: true } } });
      }

      if (k.discardChanges) {
        unsavedChanges = false;
        return resp(requestId, { keymap: { discardChanges: true } });
      }

      if (k.moveLayer) {
        const { startIndex, destIndex } = k.moveLayer;
        if (
          startIndex >= 0 &&
          startIndex < layers.length &&
          destIndex >= 0 &&
          destIndex < layers.length
        ) {
          const [moved] = layers.splice(startIndex, 1);
          layers.splice(destIndex, 0, moved);
          unsavedChanges = true;
        }
        return resp(requestId, { keymap: { moveLayer: { ok: keymap() } } });
      }

      if (k.addLayer) {
        if (layers.length >= fixture.maxLayers) {
          return resp(requestId, {
            keymap: {
              addLayer: { err: AddLayerErrorCode.ADD_LAYER_ERR_NO_SPACE },
            },
          });
        }
        const id = nextLayerId();
        const width = layers[0]?.bindings.length ?? 0;
        const layer: Layer = {
          id,
          name: "",
          bindings: Array.from({ length: width }, () => ({
            behaviorId: transparentBehaviorId,
            param1: 0,
            param2: 0,
          })),
        };
        layers.push(layer);
        unsavedChanges = true;
        return resp(requestId, {
          keymap: { addLayer: { ok: { index: layers.length - 1, layer } } },
        });
      }

      if (k.removeLayer) {
        const { layerIndex } = k.removeLayer;
        if (layerIndex >= 0 && layerIndex < layers.length) {
          const [gone] = layers.splice(layerIndex, 1);
          removed.set(gone.id, gone);
          unsavedChanges = true;
          return resp(requestId, { keymap: { removeLayer: { ok: {} } } });
        }
        return resp(requestId, {
          keymap: {
            removeLayer: {
              err: RemoveLayerErrorCode.REMOVE_LAYER_ERR_INVALID_INDEX,
            },
          },
        });
      }

      if (k.restoreLayer) {
        const { layerId, atIndex } = k.restoreLayer;
        const layer = removed.get(layerId);
        if (layer && atIndex >= 0 && atIndex <= layers.length) {
          removed.delete(layerId);
          layers.splice(atIndex, 0, layer);
          unsavedChanges = true;
          return resp(requestId, { keymap: { restoreLayer: { ok: layer } } });
        }
        return resp(requestId, {
          keymap: {
            restoreLayer: {
              err: RestoreLayerErrorCode.RESTORE_LAYER_ERR_INVALID_ID,
            },
          },
        });
      }

      if (k.setLayerProps) {
        const { layerId, name } = k.setLayerProps;
        const layer = layers.find((l) => l.id === layerId);
        if (layer) {
          layer.name = name;
          unsavedChanges = true;
          return resp(requestId, {
            keymap: {
              setLayerProps: SetLayerPropsResponse.SET_LAYER_PROPS_RESP_OK,
            },
          });
        }
        return resp(requestId, {
          keymap: {
            setLayerProps: SetLayerPropsResponse.SET_LAYER_PROPS_RESP_ERR_INVALID_ID,
          },
        });
      }
    }

    // Unhandled: resolve with a bare request/response so `call_rpc` doesn't hang.
    return resp(requestId, {});
  };
}

type RequestResponseBody = Omit<
  NonNullable<Response["requestResponse"]>,
  "requestId"
>;

function resp(requestId: number, body: RequestResponseBody): Response {
  return { requestResponse: { requestId, ...body } };
}
