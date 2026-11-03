/**
 * Minimal `swr` double for the UI smoke bundle (the real package is a pnpm dependency).
 * Supports: key | null, fetcher, { refreshInterval, keepPreviousData }, mutate(fn | value, { revalidate }).
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export default function useSWR<T>(key: string | null, fetcher: () => Promise<T>, opts: { refreshInterval?: number; keepPreviousData?: boolean; revalidateOnFocus?: boolean } = {}) {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<Error | undefined>(undefined)
  const [isLoading, setLoading] = useState<boolean>(Boolean(key))
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const load = useCallback(async () => {
    if (!key) { setData(undefined); setLoading(false); return }
    setLoading(true)
    try { setData(await fetcherRef.current()); setError(undefined) } catch (e) { setError(e as Error) } finally { setLoading(false) }
  }, [key])
  useEffect(() => {
    if (!opts.keepPreviousData) setData(undefined)
    void load()
    if (!opts.refreshInterval) return
    const t = setInterval(() => void load(), opts.refreshInterval)
    return () => clearInterval(t)
  }, [load]) // eslint-disable-line react-hooks/exhaustive-deps
  const mutate = useCallback(async (updater?: T | ((prev: T | undefined) => T | undefined), o?: { revalidate?: boolean }) => {
    if (typeof updater === 'function') setData((prev) => (updater as (p: T | undefined) => T | undefined)(prev))
    else if (updater !== undefined) setData(updater)
    if (o?.revalidate !== false && updater === undefined) await load()
  }, [load])
  return { data, error, isLoading, mutate }
}
