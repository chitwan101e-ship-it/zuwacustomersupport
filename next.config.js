const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Use this app folder as the tracing root so Next does not pick a parent lockfile (e.g. C:\Users\chitw).
  outputFileTracingRoot: path.join(__dirname),
}

module.exports = nextConfig
