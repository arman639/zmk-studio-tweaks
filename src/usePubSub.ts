import Emittery from "emittery";
import { useEffect } from "react";

const emitter = new Emittery();

// Not a hook — returns a publish function. Named without the `use` prefix so
// it can be called from plain async code (e.g. the notification reader loop)
// without tripping react-hooks/rules-of-hooks.
export const getPub = () => (name: PropertyKey, data: any) =>
  emitter.emit(name, data);

export const useSub = (
  name: PropertyKey,
  callback: (data: any) => void | Promise<void>
) => {
  const unsub = () => emitter.off(name, callback);

  // Be sure we unsub if unmounted.
  useEffect(() => {
    emitter.on(name, callback);
    return () => unsub();
  });

  return unsub;
};
