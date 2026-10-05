import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-check";
import { getPool } from "@/lib/db";
import { DEFAULT_FAILURE_RATE_PREFS, failureRatePrefsSchema } from "@/lib/failure-rate-prefs";

async function identity() {
  const { error, session } = await requireAuth();
  if (error) return { error };
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) return { error: NextResponse.json({ error: "Please sign in to save preferences." }, { status: 401 }) };
  return { email };
}

export async function GET() {
  const user = await identity();
  if (user.error) return user.error;
  try {
    const result = await getPool().query(
      "SELECT failure_rate_view AS view, failure_rate_window AS window FROM UserDashboardPrefs WHERE user_email = $1",
      [user.email],
    );
    return NextResponse.json(result.rows[0] ?? DEFAULT_FAILURE_RATE_PREFS, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to load failure rate preferences:", error);
    return NextResponse.json({ error: "Could not load preferences." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const user = await identity();
  if (user.error) return user.error;
  const parsed = failureRatePrefsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid chart preferences." }, { status: 400 });
  try {
    await getPool().query(
      `INSERT INTO UserDashboardPrefs (user_email, failure_rate_view, failure_rate_window)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_email) DO UPDATE SET
         failure_rate_view = EXCLUDED.failure_rate_view,
         failure_rate_window = EXCLUDED.failure_rate_window,
         updated_at = NOW()`,
      [user.email, parsed.data.view, parsed.data.window],
    );
    return NextResponse.json(parsed.data);
  } catch (error) {
    console.error("Failed to save failure rate preferences:", error);
    return NextResponse.json({ error: "Could not save preferences." }, { status: 500 });
  }
}
