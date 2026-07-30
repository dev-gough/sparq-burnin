import { cookies } from "next/headers";

import { DashboardHome } from "@/components/dashboard/dashboard-home";
import {
  DASHBOARD_BOOT_COOKIE,
  parseDashboardBootCookie,
} from "@/lib/dashboard-prefs";

/**
 * Server entry: read the boot cookie so the first HTML paint already reflects
 * the user's last period / result mode (no 30d/Latest → All/All-tests flash).
 * localStorage remains the full client source of truth and re-mirrors the cookie.
 */
export default async function Page() {
  const jar = await cookies();
  const boot = parseDashboardBootCookie(
    jar.get(DASHBOARD_BOOT_COOKIE)?.value,
  );

  return <DashboardHome boot={boot} />;
}
