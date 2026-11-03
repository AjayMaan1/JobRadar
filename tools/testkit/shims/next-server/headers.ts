/** next/headers double: request-scoped cookies/headers set by the test via `setRequestContext()`. */
let ctx: { cookies: Record<string, string>; headers: Record<string, string> } = { cookies: {}, headers: {} }
export function setRequestContext(c: { cookies?: Record<string, string>; headers?: Record<string, string> }) { ctx = { cookies: c.cookies ?? {}, headers: c.headers ?? {} } }
export async function cookies() {
  return { get: (n: string) => (n in ctx.cookies ? { name: n, value: ctx.cookies[n] } : undefined), set: () => undefined, getAll: () => Object.entries(ctx.cookies).map(([name, value]) => ({ name, value })) }
}
export async function headers() { return new Headers(ctx.headers) }
