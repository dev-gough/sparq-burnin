import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

// Check if authentication should be skipped (for local development)
const shouldSkipAuth = process.env.SKIP_AUTH === 'true';

/**
 * Checks if the user is authenticated via NextAuth session
 * Returns the session if authenticated, or a 401 response if not
 *
 * If SKIP_AUTH=true, authentication is optional - returns actual session if signed in,
 * or allows access without session (returns null session)
 */
export async function requireAuth() {
  const session = await auth();

  // If user has a valid session, always use it (regardless of SKIP_AUTH)
  if (session && session.user) {
    return {
      error: null,
      session,
    };
  }

  // If no session but SKIP_AUTH is enabled, allow access without authentication
  if (shouldSkipAuth) {
    return {
      error: null,
      session: null,
    };
  }

  // Otherwise, require authentication
  return {
    error: NextResponse.json(
      { error: "Unauthorized. Please sign in." },
      { status: 401 }
    ),
    session: null,
  };
}
