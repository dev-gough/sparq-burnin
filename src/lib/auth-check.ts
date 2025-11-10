import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

/**
 * Checks if the user is authenticated via NextAuth session
 * Returns the session if authenticated, or a 401 response if not
 */
export async function requireAuth() {
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
