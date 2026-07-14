import type { NextConfig } from "next"

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tiles.openfreemap.org https://tiles.versatiles.org",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://tiles.openfreemap.org https://tiles.versatiles.org",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "font-src 'self' data: https://tiles.openfreemap.org https://tiles.versatiles.org",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ")

const nextConfig: NextConfig = {
  // Self-contained server bundle (.next/standalone) for the Docker image.
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ]
  },
}

export default nextConfig
