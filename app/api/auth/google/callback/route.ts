import { NextRequest, NextResponse } from "next/server";
import {
  decryptPayload,
  encryptPayload,
  GOOGLE_SESSION_COOKIE,
  GOOGLE_STATE_COOKIE,
  GoogleSession,
  sessionCookieOptions,
} from "../../../../../lib/google-session";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const stateCookie = request.cookies.get(GOOGLE_STATE_COOKIE)?.value;
  if (!code || !state || !stateCookie) return NextResponse.redirect(new URL("/login?error=oauth", request.url));

  try {
    const stored = await decryptPayload<{ state: string; createdAt: number }>(stateCookie);
    if (stored.state !== state || Date.now() - stored.createdAt > 600_000) throw new Error("Invalid OAuth state");
    const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? new URL("/api/auth/google/callback", request.url).toString();
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenResponse.ok) throw new Error(`Token exchange failed: ${tokenResponse.status}`);
    const tokens = await tokenResponse.json() as { access_token: string; refresh_token?: string; expires_in: number };
    const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!userResponse.ok) throw new Error(`User info failed: ${userResponse.status}`);
    const user = await userResponse.json() as { email: string; name?: string; picture?: string };
    const session: GoogleSession = {
      email: user.email,
      name: user.name ?? user.email,
      picture: user.picture,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };
    const response = NextResponse.redirect(new URL("/profile", request.url));
    response.cookies.set(GOOGLE_SESSION_COOKIE, await encryptPayload(session), sessionCookieOptions(request.url));
    response.cookies.set(GOOGLE_STATE_COOKIE, "", { ...sessionCookieOptions(request.url), maxAge: 0 });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/login?error=oauth", request.url));
  }
}
