import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "ru.listok.purchases",
  appName: "Листок",
  webDir: "mobile-shell",
  server: {
    url: process.env.CAPACITOR_SERVER_URL ?? "http://10.10.40.165:3000",
    cleartext: true,
    androidScheme: "http",
  },
  android: {
    allowMixedContent: true,
    backgroundColor: "#f3f4f3",
  },
  plugins: {
    StatusBar: {
      overlaysWebView: false,
      style: "DARK",
      backgroundColor: "#ffffff",
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
