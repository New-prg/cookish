// The AI key and the provider warning stay on this device during the test
// (epic #44): the person enters the key in Profile, and the UI sends it to the
// assistant Service with each request. Both go away when the Service moves to
// the server (#31).

export const AI_PROVIDER_LABEL = "routerai.ru";
export const AI_KEY_STORAGE = "cookish.ai.key.test";
export const AI_CONSENT_STORAGE = "cookish.ai.consent.v1";

// The key is stored under its own storage key, so it never enters the local
// data blob, its backups or a future export and sync.
export function aiKeyStore(storage) {
  return {
    read() {
      try {
        return String(storage?.getItem(AI_KEY_STORAGE) || "").trim();
      } catch {
        return "";
      }
    },
    write(key) {
      const value = String(key || "").trim();
      if (!value) return false;
      try {
        storage.setItem(AI_KEY_STORAGE, value);
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      try {
        storage?.removeItem(AI_KEY_STORAGE);
      } catch {
        // Nothing to remove.
      }
    },
  };
}

// One-time warning that plan and statistics data go to the external provider.
export function aiConsentStore(storage) {
  return {
    accepted() {
      try {
        return storage?.getItem(AI_CONSENT_STORAGE) === "1";
      } catch {
        return false;
      }
    },
    accept() {
      try {
        storage.setItem(AI_CONSENT_STORAGE, "1");
      } catch {
        // The warning shows again next time.
      }
    },
  };
}

export const AI_CONSENT_TEXT = `Ассистент отправляет данные плана, профиля и статистики внешнему провайдеру ${AI_PROVIDER_LABEL}. Ключ остаётся на этом устройстве. Продолжить?`;
