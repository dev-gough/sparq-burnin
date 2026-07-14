/**
 * Next.js instrumentation entry.
 *
 * Node log capture lives in instrumentation.node.ts. Edge builds still analyze
 * that graph; next.config aliases Node built-ins for the Edge runtime so the
 * production build succeeds. register() is a no-op on Edge.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { registerNode } = await import('./instrumentation.node')
  await registerNode()
}
