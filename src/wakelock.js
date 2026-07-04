import { useEffect } from "react";

/* Keep the phone screen awake while hosting or following a session.
   The browser silently releases the lock when the tab is hidden, so we
   re-acquire it every time the page becomes visible again. No-ops where
   the API is unsupported (old iOS) or the context is insecure. */
export function useWakeLock(active = true) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock = null, stopped = false;

    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
        if (stopped) lock.release().catch(() => {});
      } catch { /* denied (low battery etc.) — nothing to do */ }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") acquire();
    };

    acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch(() => {});
    };
  }, [active]);
}
