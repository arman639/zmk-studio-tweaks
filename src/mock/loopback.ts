import type { RpcTransport } from "@zmkfirmware/zmk-studio-ts-client/transport/index";
import { Request, Response } from "@zmkfirmware/zmk-studio-ts-client";
import {
  get_decoder,
  get_encoder,
} from "@zmkfirmware/zmk-studio-ts-client/framing";

/**
 * Produces the response(s) to a decoded {@link Request}. Most requests map to a
 * single {@link Response}; returning an array allows e.g. emitting an extra
 * notification alongside the request/response.
 */
export type RpcHandler = (request: Request) => Response | Response[];

/**
 * A generic in-memory {@link RpcTransport} that loops bytes back through a
 * handler instead of talking to real hardware.
 *
 * It speaks the exact wire format the firmware does — protobuf framing on the
 * way in, protobuf framing on the way out — so the entire real RPC stack
 * (`create_rpc_connection`, `call_rpc`, the notification reader) runs unchanged
 * on top of it. It knows nothing about ZMK device semantics; the `handler`
 * supplies those. Keeping this layer device-agnostic is deliberate: it is the
 * part that could plausibly be contributed upstream, while the device fixtures
 * stay fork-local.
 */
export function createLoopbackTransport(
  label: string,
  handler: RpcHandler
): RpcTransport {
  const abortController = new AbortController();

  // Device -> host: raw Response bytes written here get framed and surface on
  // `readable`, which `create_rpc_connection` deframes + decodes for us.
  const responseFrames = new TransformStream<Uint8Array, Uint8Array>(
    get_encoder()
  );
  const responseWriter = responseFrames.writable.getWriter();

  const emit = (response: Response) =>
    responseWriter.write(Response.encode(response).finish());

  // Host -> device: framed Request bytes arrive on `writable`; deframe them,
  // decode, hand to the handler, and emit each Response.
  const requestFrames = new TransformStream<Uint8Array, Uint8Array>(
    get_decoder()
  );

  (async () => {
    const reader = requestFrames.readable.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        const request = Request.decode(value);
        const responses = handler(request);
        for (const response of Array.isArray(responses)
          ? responses
          : [responses]) {
          await emit(response);
        }
      }
    } catch (e) {
      abortController.abort(e);
    } finally {
      reader.releaseLock();
      await responseWriter.close().catch(() => {});
    }
  })();

  return {
    label,
    abortController,
    readable: responseFrames.readable,
    writable: requestFrames.writable,
  };
}
