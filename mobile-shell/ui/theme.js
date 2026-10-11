// The theme chosen in Профиль: "light", "dark" or "system" (the default). It is
// a setting of this device, kept outside the synced data like the AI key.
// index.html reads the same key before the first paint.
export const THEME_KEY = "cookish.theme";
export const THEME_OPTIONS = [["light", "Светлая"], ["dark", "Тёмная"], ["system", "Как в системе"]];

export function themeStore(storage) {
  return {
    read() {
      try {
        const value = storage?.getItem(THEME_KEY);
        return value === "light" || value === "dark" ? value : "system";
      } catch {
        return "system";
      }
    },
    write(value) {
      try {
        if (value === "light" || value === "dark") storage.setItem(THEME_KEY, value);
        else storage?.removeItem(THEME_KEY);
      } catch {
        // An unavailable storage keeps the theme for this session only.
      }
    },
  };
}
