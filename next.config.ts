import type { NextConfig } from "next"

// connect-src must follow the configured Supabase origin (local stack in dev,
// self-hosted on the VPS in prod); http(s) for REST/Auth, ws(s) for Realtime.
const supabaseOrigin =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "") ??
  "https://*.supabase.co"
const supabaseWsOrigin = supabaseOrigin.replace(/^http/, "ws")

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tiles.openfreemap.org",
  `connect-src 'self' ${supabaseOrigin} ${supabaseWsOrigin} https://tiles.openfreemap.org`,
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "font-src 'self' data: https://tiles.openfreemap.org",
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
