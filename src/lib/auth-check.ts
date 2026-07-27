import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";

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

/**
 * Default allowlists live in config.json (`auth` section), NOT in source:
 *
 *   "auth": {
 *     "restore_allowlist": ["user@sparqsys.com"],
 *     "station_admin_allowlist": ["user@sparqsys.com"]
 *   }
 *
 * The corresponding env var (RESTORE_ALLOWLIST / STATION_ADMIN_ALLOWLIST,
 * comma-separated) takes precedence over config.json when set. Missing env var
 * AND missing config entry means an empty allowlist: everyone is denied
 * (except under SKIP_AUTH — see below).
 */
function configAllowlist(key: "restore_allowlist" | "station_admin_allowlist"): string[] {
  try {
    const config = loadConfig() as ReturnType<typeof loadConfig> & {
      auth?: { restore_allowlist?: string[]; station_admin_allowlist?: string[] };
    };
    const list = config.auth?.[key];
    if (Array.isArray(list)) {
      return list.map((e) => String(e).trim().toLowerCase()).filter(Boolean);
    }
  } catch {
    /* config unavailable → fall through to empty */
  }
  return [];
}

/**
 * Factory for email-allowlist auth gates (privileged operations on top of the
 * normal session requirement).
 *
 * SKIP_AUTH unification (plan 2.3): the restore gate used to enforce the
 * allowlist even under SKIP_AUTH, while the station-admin gate bypassed it.
 * We standardize on the station-admin behavior — SKIP_AUTH=true bypasses the
 * allowlist entirely (local dev without Entra works for every gated UI/API).
 * SKIP_AUTH is a dev-only escape hatch and must stay unset in production, so
 * production behavior is unchanged.
 */
function makeAllowlistAuth(options: {
  envVar: string;
  configKey: "restore_allowlist" | "station_admin_allowlist";
  noUserMessage: string;
  notAllowedMessage: string;
}) {
  const getAllowlist = (): string[] => {
    const envList = process.env[options.envVar];
    if (envList && envList.trim().length > 0) {
      return envList
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
    }
    return configAllowlist(options.configKey);
  };

  const isAllowed = (email: string | null | undefined): boolean => {
    if (shouldSkipAuth) return true; // dev/local bypass
    if (!email) return false;
    return getAllowlist().includes(email.toLowerCase());
  };

  const require = async () => {
    if (shouldSkipAuth) {
      const session = (await auth()) ?? null;
      return { error: null, session };
    }

    const { error: authError, session } = await requireAuth();
    if (authError) return { error: authError, session: null };

    const email = session?.user?.email?.toLowerCase();
    if (!email) {
      return {
        error: NextResponse.json({ error: options.noUserMessage }, { status: 403 }),
        session: null,
      };
    }

    if (!getAllowlist().includes(email)) {
      return {
        error: NextResponse.json({ error: options.notAllowedMessage }, { status: 403 }),
        session: null,
      };
    }

    return { error: null, session };
  };

  return { require, isAllowed };
}

/**
 * Restore gate: signed-in user on the restore allowlist
 * (config.json auth.restore_allowlist, overridable via RESTORE_ALLOWLIST).
 * Gates destructive/data-recovery endpoints (e.g. annotation restore).
 */
const restoreAuth = makeAllowlistAuth({
  envVar: "RESTORE_ALLOWLIST",
  configKey: "restore_allowlist",
  noUserMessage: "Forbidden. Restore requires a signed-in user.",
  notAllowedMessage:
    "Forbidden. Your account is not authorized to restore annotations.",
});

export const requireRestoreAuth = restoreAuth.require;

/**
 * Returns true if the given email is on the restore allowlist.
 * Used by the UI to conditionally render the restore controls.
 */
export const isOnRestoreAllowlist = restoreAuth.isAllowed;

/**
 * Station-admin gate: signed-in user on the station admin allowlist
 * (config.json auth.station_admin_allowlist, overridable via
 * STATION_ADMIN_ALLOWLIST). Gates remote station enable/disable.
 */
const stationAdminAuth = makeAllowlistAuth({
  envVar: "STATION_ADMIN_ALLOWLIST",
  configKey: "station_admin_allowlist",
  noUserMessage: "Forbidden. Station admin requires a signed-in user.",
  notAllowedMessage: "Forbidden. Your account is not authorized to manage stations.",
});

export const requireStationAdminAuth = stationAdminAuth.require;
export const isOnStationAdminAllowlist = stationAdminAuth.isAllowed;
