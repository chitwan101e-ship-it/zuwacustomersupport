const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Use this app folder as the tracing root so Next does not pick a parent lockfile (e.g. C:\Users\chitw).
  outputFileTracingRoot: path.join(__dirname),

  // Hide the floating "N" dev indicator badge in the browser.
  devIndicators: false,

  // Smaller per-route chunks (helps avoid dev ChunkLoadError / timeout on heavy pages like /feed).
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },

  webpack: (config, { dev, isServer }) => {
    if (dev && !isServer && config.output) {
      config.output.chunkLoadTimeout = 300_000
    }
    return config
  },
}

module.exports = nextConfig
