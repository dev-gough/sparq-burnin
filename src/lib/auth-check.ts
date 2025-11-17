import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

// Check if authentication should be skipped (for local development)
const shouldSkipAuth = process.env.SKIP_AUTH === 'true';

/**
 * Checks if the user is authenticated via NextAuth session
 * Returns the session if authenticated, or a 401 response if not
 *
 * If SKIP_AUTH=true, authentication is bypassed and a mock session is returned
 */
export async function requireAuth() {
  // If auth is disabled (local dev), return a mock successful session
  if (shouldSkipAuth) {
    return {
      error: null,
      session: {
        user: {
          id: 'local-dev-user',
          name: 'Local Developer',
          email: 'dev@local.dev',
        },
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
    };
  }

  // Otherwise, perform normal authentication check
  const session = await auth();

  if (!session || !session.user) {
    return {
      error: NextResponse.json(
        { error: "Unauthorized. Please sign in." },
        { status: 401 }
      ),
      session: null,
    };
  }

  return {
    error: null,
    session,
  };
}
