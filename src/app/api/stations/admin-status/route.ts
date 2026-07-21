import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { isOnStationAdminAllowlist } from '@/lib/auth-check'

/** GET — whether the current session may manage stations (for sidebar/UI). */
export async function GET() {
  const session = await auth()
  const email = session?.user?.email ?? null
  return NextResponse.json({
    isStationAdmin: isOnStationAdminAllowlist(email),
    email,
  })
}
