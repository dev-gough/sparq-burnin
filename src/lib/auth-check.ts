import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

// Check if authentication should be skipped (for local development)
const shouldSkipAuth = process.env.SKIP_AUTH === 'true';

/**
 * Hardcoded allowlist of email addresses authorized to perform privileged
 * data-recovery operations such as restoring TestAnnotations from a backup.
 *
 * To add users, append their @sparqsys.com email here OR set the
 * RESTORE_ALLOWLIST environment variable (comma-separated) to override.
 */
const DEFAULT_RESTORE_ALLOWLIST: string[] = [
  "tkulin@sparqsys.com",
  "dgough@sparqsys.com",
];

function getRestoreAllowlist(): string[] {
  const envList = process.env.RESTORE_ALLOWLIST;
  if (envList && envList.trim().length > 0) {
    return envList
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  }
  return DEFAULT_RESTORE_ALLOWLIST.map((e) => e.toLowerCase());
}

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

/**
 * Requires the caller to be signed in AND on the restore allowlist.
 * Used to gate destructive/data-recovery endpoints (e.g. annotation restore).
 *
 * Unlike requireAuth, SKIP_AUTH does NOT bypass the allowlist check — even in
 * local dev, the session must exist and its email must be on the list.
 */
export async function requireRestoreAuth() {
  const { error: authError, session } = await requireAuth();
  if (authError) return { error: authError, session: null };

  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    return {
      error: NextResponse.json(
        { error: "Forbidden. Restore requires a signed-in user." },
        { status: 403 }
      ),
      session: null,
    };
  }

  const allowlist = getRestoreAllowlist();
  if (!allowlist.includes(email)) {
    return {
      error: NextResponse.json(
        { error: "Forbidden. Your account is not authorized to restore annotations." },
        { status: 403 }
      ),
      session: null,
    };
  }

  return { error: null, session };
}

/**
 * Returns true if the given email is on the restore allowlist.
 * Used by the UI to conditionally render the restore controls.
 */
export function isOnRestoreAllowlist(email: string | null | undefined): boolean {
  if (!email) return false;
  return getRestoreAllowlist().includes(email.toLowerCase());
}
