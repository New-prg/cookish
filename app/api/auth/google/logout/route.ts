import { NextRequest, NextResponse } from "next/server";
import { GOOGLE_SESSION_COOKIE, sessionCookieOptions } from "../../../../../lib/google-session";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(GOOGLE_SESSION_COOKIE, "", { ...sessionCookieOptions(request.url), maxAge: 0 });
  return response;
}
