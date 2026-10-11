import { STORAGE_KEY } from "../core/local-data.js";

// Platform adapters: the WebView's storage and network and the Android bridge.
// Core and Services never touch these globals; the UI passes the adapters in.

// An error of the AI transport port: the provider reads its `kind`.
function transportFailure(kind) {
  return Object.assign(new Error(kind), { kind });
}

export function browserStorage(localStorage, key = STORAGE_KEY) {
  // Backups are written once per label and never overwritten, so the data an
  // older build left behind survives a faulty migration or an unreadable blob.
  function keepOnce(label, raw) {
    const backupKey = `${key}.backup.${label}`;
    try {
      if (localStorage.getItem(backupKey) == null) localStorage.setItem(backupKey, raw);
    } catch {
      // A backup must never block opening the app.
    }
  }

  return {
    read() {
      let raw = null;
      try {
        raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        if (raw) keepOnce("unreadable", raw);
        return null;
      }
    },
    write(state) {
      localStorage.setItem(key, JSON.stringify(state));
    },
    backup(state, label) {
      keepOnce(label, JSON.stringify(state));
    },
  };
}

export function platformFetch(host = globalThis) {
  return (url, init) => host.fetch(url, init);
}

export function isOnline(host = globalThis) {
  return host.navigator?.onLine !== false;
}

export const DEVELOPER_OFFLINE_KEY = "cookish.dev.offline";

// A developer flag for offline checks (ADR-0002): with
// localStorage["cookish.dev.offline"] = "1" the transport answers as without
// a network.
export function developerOffline(host = globalThis) {
  try {
    return host.localStorage?.getItem(DEVELOPER_OFFLINE_KEY) === "1";
  } catch {
    return false;
  }
}

// The Android bridge performs the request natively: the WebView origin is not
// subject to the provider's CORS rules there. `host` receives the callback.
export function nativeTransport(bridge, host = globalThis) {
  const pending = new Map();
  let sequence = 0;
  host.__onNativeAiResponse = (id, payload) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    let result = null;
    try {
      result = JSON.parse(payload);
    } catch {
      entry.reject(transportFailure("bad_response"));
      return;
    }
    if (result?.error) entry.reject(transportFailure(result.error === "timeout" ? "timeout" : "network"));
    else entry.resolve({ status: Number(result?.status) || 0, text: String(result?.body || "") });
  };
  return ({ method, url, headers, body, timeoutMs, signal }) => new Promise((resolve, reject) => {
    const id = `ai_${Date.now()}_${sequence += 1}`;
    pending.set(id, { resolve, reject });
    signal?.addEventListener?.("abort", () => {
      if (pending.delete(id)) reject(transportFailure("timeout"));
    });
    bridge.aiRequest(id, JSON.stringify({ method, url, headers, body: body || "", timeoutMs }));
  });
}

// The Android bridge for the provider's requests, or undefined in a browser,
// where the Services use fetch.
export function nativeAiTransport(host = globalThis) {
  return host.NativeCookish?.aiRequest ? nativeTransport(host.NativeCookish, host) : undefined;
}

