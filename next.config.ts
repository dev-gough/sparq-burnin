import type { NextConfig } from 'next'

/**
 * instrumentation.ts is compiled for both Node and Edge. Node-only modules
 * (fs/path/crypto) used by log capture must not break the Edge bundle.
 * register() no-ops when NEXT_RUNTIME !== 'nodejs'; these aliases silence
 * analysis of the Node-only import graph under Turbopack (and Webpack).
 */
const nextConfig: NextConfig = {
  // Turbopack is the default bundler in Next.js 16.
  turbopack: {
    resolveAlias: {
      // Empty-module stubs for Edge/browser analysis of instrumentation.node
      fs: { browser: './src/lib/empty-module.ts' },
      path: { browser: './src/lib/empty-module.ts' },
      crypto: { browser: './src/lib/empty-module.ts' },
      child_process: { browser: './src/lib/empty-module.ts' },
      'node:fs': { browser: './src/lib/empty-module.ts' },
      'node:path': { browser: './src/lib/empty-module.ts' },
      'node:crypto': { browser: './src/lib/empty-module.ts' },
    },
  },
  // Keep Webpack builds working if someone passes --webpack.
  webpack: (config, { nextRuntime }) => {
    if (nextRuntime === 'edge') {
      config.resolve = config.resolve ?? {}
      const alias = (config.resolve.alias ?? {}) as Record<string, string | false>
      config.resolve.alias = {
        ...alias,
        fs: false,
        path: false,
        crypto: false,
        child_process: false,
        'node:fs': false,
        'node:path': false,
        'node:crypto': false,
      }
    }
    return config
  },
}

export default nextConfig
