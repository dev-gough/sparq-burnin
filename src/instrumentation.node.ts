/**
 * Node-only instrumentation side effects.
 * Imported exclusively from instrumentation.ts when NEXT_RUNTIME === 'nodejs'
 * so the Edge instrumentation bundle never pulls in fs/path/crypto.
 */

export async function registerNode(): Promise<void> {
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
      version:
        process.env.APP_VERSION || process.env.npm_package_version || '0.7.0',
    })
  } catch (err) {
    console.error('[instrumentation] app log boot failed', err)
  }
}
