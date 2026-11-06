import { useCallback, useRef } from "react";

/**
 * Lets a scrollable element work when it is portaled outside a Radix Dialog
 * (or any `react-remove-scroll` lock).
 *
 * The Dialog adds a non-passive, bubble-phase `wheel`/`touchmove` listener on
 * `document` that calls `preventDefault()` for any scroll event originating
 * outside the dialog's DOM subtree — which includes Popover content portaled to
 * `document.body`. By stopping propagation on the element itself (below
 * `document`), the event never reaches that listener and native scrolling works.
 *
 * Attach the returned ref to the element with `overflow-y-auto`.
 */
export function useScrollLockEscape<T extends HTMLElement>() {
  const cleanupRef = useRef<(() => void) | null>(null);

  return useCallback((node: T | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;

    if (!node) return;

    const stop = (event: Event) => event.stopPropagation();
    const options: AddEventListenerOptions = { passive: false };

    node.addEventListener("wheel", stop, options);
    node.addEventListener("touchmove", stop, options);

    cleanupRef.current = () => {
      node.removeEventListener("wheel", stop, options);
      node.removeEventListener("touchmove", stop, options);
    };
  }, []);
}
