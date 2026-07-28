import { cookies } from "next/headers";

export const GOOGLE_SESSION_COOKIE = "listok_google_session";
export const GOOGLE_STATE_COOKIE = "listok_google_state";

export type GoogleSession = {
  email: string;
  name: string;
  picture?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
};

export function googleOAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.AUTH_SECRET);
}

export async function readGoogleSession() {
  const value = (await cookies()).get(GOOGLE_SESSION_COOKIE)?.value;
  if (!value) return null;
  try {
    return await decryptPayload<GoogleSession>(value);
  } catch {
    return null;
  }
}

export async function ensureGoogleAccessToken(session: GoogleSession) {
  if (session.expiresAt > Date.now() + 60_000) return { token: session.accessToken, session, refreshed: false };
  if (!session.refreshToken) throw new Error("Google session expired");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: required("GOOGLE_CLIENT_ID"),
      client_secret: required("GOOGLE_CLIENT_SECRET"),
      refresh_token: session.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error(`Google token refresh failed: ${response.status}`);
  const tokens = await response.json() as { access_token: string; expires_in: number };
  const updated = { ...session, accessToken: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
  return { token: updated.accessToken, session: updated, refreshed: true };
}

export async function encryptPayload(value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey();
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return `${base64Url(iv)}.${base64Url(new Uint8Array(encrypted))}`;
}

export async function decryptPayload<T>(value: string) {
  const [ivValue, payloadValue] = value.split(".");
  if (!ivValue || !payloadValue) throw new Error("Invalid encrypted payload");
  const key = await encryptionKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(ivValue) },
    key,
    fromBase64Url(payloadValue),
  );
  return JSON.parse(new TextDecoder().decode(decrypted)) as T;
}

export function sessionCookieOptions(requestUrl: string) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: new URL(requestUrl).protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function encryptionKey() {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(required("AUTH_SECRET")));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
