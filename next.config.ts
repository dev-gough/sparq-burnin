import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * instrumentation.ts is compiled for both Node and Edge. Node-only modules
   * (fs/path/crypto) used by log capture must not break the Edge bundle.
   * Alias them empty for Edge; register() no-ops when NEXT_RUNTIME !== 'nodejs'.
   */
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
