import type { NextConfig } from 'next'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '../../.env') })

/** Security headers (audit NEW-12). CSP is report-only until the inline-style budget of the UI is known. */
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(process.env.NODE_ENV === 'production' ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
  {
    key: process.env.CSP_ENFORCE === '1' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV !== 'production' ? " 'unsafe-eval'" : ''),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join('; '),
  },
]

const nextConfig: NextConfig = {
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: SECURITY_HEADERS }]
  },
  transpilePackages: ['@jobradar/db', '@jobradar/resume', '@jobradar/storage', '@jobradar/llm', '@jobradar/log', '@jobradar/notifications', '@jobradar/prefs', '@jobradar/extractor'],
  serverExternalPackages: ['unpdf', 'mammoth', 'docx', 'playwright', 'playwright-core', 'bullmq', 'ioredis', '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner'],
  // Workspace packages use NodeNext-style "./x.js" specifiers that point at .ts sources.
  webpack: (config, { isServer }) => {
    config.resolve.extensionAlias = { ...(config.resolve.extensionAlias ?? {}), '.js': ['.ts', '.tsx', '.js'] }
    if (isServer) {
      // Chromium rendering happens in the worker only; never bundle playwright into the web server build.
      config.externals = [...(Array.isArray(config.externals) ? config.externals : [config.externals]).filter(Boolean), { playwright: 'commonjs playwright', 'playwright-core': 'commonjs playwright-core' }]
    }
    return config
  },
}

export default nextConfig
