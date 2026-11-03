/** Browser-side next/navigation double: real window.location, full-page navigation. */
import { useEffect, useState } from 'react'
export const useRouter = () => ({
  push: (h: string) => { window.location.assign(h) },
  replace: (h: string) => { window.location.replace(h) },
  refresh: () => { window.location.reload() },
  back: () => history.back(),
})
export const usePathname = () => window.location.pathname
export const useSearchParams = () => {
  const [sp, setSp] = useState(() => new URLSearchParams(window.location.search))
  useEffect(() => { const f = () => setSp(new URLSearchParams(window.location.search)); window.addEventListener('popstate', f); return () => window.removeEventListener('popstate', f) }, [])
  return sp
}
export const redirect = (to: string) => { window.location.assign(to) }
export const notFound = () => { throw new Error('NEXT_NOT_FOUND') }
