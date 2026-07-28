import { NextResponse } from "next/server";
import { googleOAuthConfigured, readGoogleSession } from "../../../../../lib/google-session";

export async function GET() {
  const session = await readGoogleSession();
  return NextResponse.json({
    configured: googleOAuthConfigured(),
    authenticated: Boolean(session),
    user: session ? { email: session.email, name: session.name, picture: session.picture } : null,
  });
}
