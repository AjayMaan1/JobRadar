/** next/navigation double for SSR smoke tests: static pathname/search params, no-op router. */
export const useRouter = () => ({ push: (_h: string) => undefined, replace: (_h: string) => undefined, refresh: () => undefined, back: () => undefined })
export const useSearchParams = () => new URLSearchParams(process.env.SMOKE_SEARCH ?? '')
export const usePathname = () => process.env.SMOKE_PATH ?? '/'
export class RedirectError extends Error { constructor(public to: string) { super(`NEXT_REDIRECT:${to}`) } }
export const redirect = (to: string): never => { throw new RedirectError(to) }
export const notFound = (): never => { throw new Error('NEXT_NOT_FOUND') }
