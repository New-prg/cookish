import { createId } from "./replay.js";

// The Гостевой аккаунт (ADR-0002): created silently on the first start, even
// without a network. The full Core registers it with the first delivery; the
// person may attach an email later.

export const GUEST_STORAGE_KEY = "cookish.guest.v1";

export function openGuest(storage) {
  const stored = storage.read();
  if (stored?.id) return { id: String(stored.id), createdAt: String(stored.createdAt || "") };
  const guest = { id: createId("guest"), createdAt: new Date().toISOString() };
  try {
    storage.write(guest);
  } catch {
    // The next start tries again; until then the id lives in memory.
  }
  return guest;
}
