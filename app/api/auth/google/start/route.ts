import { NextRequest, NextResponse } from "next/server";
import { encryptPayload, GOOGLE_STATE_COOKIE, googleOAuthConfigured, sessionCookieOptions } from "../../../../../lib/google-session";

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/spreadsheets",
].join(" ");

export async function GET(request: NextRequest) {
  if (!googleOAuthConfigured()) return NextResponse.redirect(new URL("/login?error=config", request.url));
  const state = crypto.randomUUID();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? new URL("/api/auth/google/callback", request.url).toString();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  }).toString();
  const response = NextResponse.redirect(url);
  response.cookies.set(GOOGLE_STATE_COOKIE, await encryptPayload({ state, createdAt: Date.now() }), {
    ...sessionCookieOptions(request.url),
    path: "/api/auth/google/callback",
    maxAge: 600,
  });
  return response;
}
