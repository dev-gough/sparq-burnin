/**
 * Next.js instrumentation — Node server boot only.
 * Captures stdout/stderr + structured app boot for Control Center ops logs.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  try {
    const { installNextServerLogCapture } = await import(
      '@/lib/nextServerLogCapture'
    )
    installNextServerLogCapture()
  } catch (err) {
    console.error('[instrumentation] next server log capture failed', err)
  }

  try {
    const { logAppEvent } = await import('@/lib/appLogger')
    logAppEvent('SERVER_BOOT', {
      nodeEnv: process.env.NODE_ENV,
      service: 'mfg-datavis',
      version: process.env.APP_VERSION || process.env.npm_package_version || '0.7.0',
    })
  } catch (err) {
    console.error('[instrumentation] app log boot failed', err)
  }
}
