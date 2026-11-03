/**
 * Loose ambient types for third-party modules that are not installed in the offline sandbox. Real CI runs
 * `pnpm -r typecheck` with the real packages; this only keeps the sandbox typecheck useful for our own code.
 */
declare module 'bullmq' {
  export type JobsOptions = Record<string, any>
  export class Queue<T = any> { constructor(name: string, opts?: any); name: string; add(name: string, data: T, opts?: any): Promise<{ id?: string }>; close(): Promise<void>; getJobCounts(...t: string[]): Promise<Record<string, number>>; getJobSchedulers(a?: number, b?: number): Promise<Array<{ key?: string }>>; removeJobScheduler(k: string): Promise<any>; upsertJobScheduler(k: string, r: any, t?: any): Promise<any>; getFailed(a?: number, b?: number): Promise<Job<T>[]>; getJobs(types: string[], a?: number, b?: number): Promise<Job<T>[]>; getJob(id: string): Promise<Job<T> | undefined>; drain(): Promise<void>; clean(grace: number, limit: number, type?: string): Promise<string[]>; getWaitingCount(): Promise<number>; getActiveCount(): Promise<number>; getFailedCount(): Promise<number>; getDelayedCount(): Promise<number>; getCompletedCount(): Promise<number> }
  export class Worker<T = any, R = any> { constructor(name: string, fn: (job: Job<T>) => Promise<R>, opts?: any); name: string; on(ev: string, fn: (...a: any[]) => void): void; close(): Promise<void> }
  export class Job<T = any> { id?: string; name: string; data: T; attemptsMade: number; failedReason?: string; timestamp: number; finishedOn?: number; processedOn?: number; retry(): Promise<void>; remove(): Promise<void>; getState(): Promise<string>; stacktrace: string[]; opts: any }
}
declare module 'ioredis' {
  export default class Redis {
    constructor(url?: string, opts?: any)
    on(ev: string, fn: (...a: any[]) => void): void
    get(k: string): Promise<string | null>
    set(k: string, v: string | number, ...a: any[]): Promise<any>
    setex(k: string, ttl: number, v: string): Promise<any>
    del(...k: string[]): Promise<number>
    incr(k: string): Promise<number>
    incrby(k: string, n: number): Promise<number>
    incrbyfloat(k: string, n: number): Promise<string>
    expire(k: string, ttl: number): Promise<number>
    ttl(k: string): Promise<number>
    hincrby(k: string, f: string, n: number): Promise<number>
    hgetall(k: string): Promise<Record<string, string>>
    hset(k: string, ...a: any[]): Promise<number>
    hget(k: string, f: string): Promise<string | null>
    keys(p: string): Promise<string[]>
    scan(...a: any[]): Promise<[string, string[]]>
    publish(ch: string, msg: string): Promise<number>
    subscribe(...ch: string[]): Promise<number>
    unsubscribe(...ch: string[]): Promise<number>
    psubscribe(...ch: string[]): Promise<number>
    duplicate(): Redis
    quit(): Promise<any>
    disconnect(): void
    ping(): Promise<string>
    multi(): any
    pipeline(): any
    exists(...k: string[]): Promise<number>
    zadd(...a: any[]): Promise<any>
    zrangebyscore(...a: any[]): Promise<string[]>
    zremrangebyscore(...a: any[]): Promise<number>
    sadd(...a: any[]): Promise<number>
    smembers(k: string): Promise<string[]>
    srem(...a: any[]): Promise<number>
    status: string
    connect(): Promise<void>
    [k: string]: any
  }
}
declare module 'next/server' {
  export class NextRequest extends Request { nextUrl: URL & { pathname: string; search: string; searchParams: URLSearchParams; clone(): any }; cookies: { get(n: string): { value: string } | undefined; set(...a: any[]): void }; ip?: string; formData(): Promise<FormData> }
  export class NextResponse extends Response {
    static json(body: any, init?: ResponseInit): NextResponse
    static next(init?: any): NextResponse
    static redirect(url: string | URL, status?: number): NextResponse
    cookies: { set(c: any): void; get(n: string): any; delete(n: string): void }
    headers: Headers
  }
}
declare module 'next/headers' { export function cookies(): Promise<{ get(n: string): { value: string } | undefined; set(...a: any[]): void }>; export function headers(): Promise<Headers> }
declare module 'next/navigation' { export function useRouter(): { push(u: string): void; replace(u: string): void; refresh(): void }; export function useSearchParams(): URLSearchParams; export function usePathname(): string; export function redirect(u: string): never }
declare module 'next/link' { const Link: any; export default Link }
declare module 'next' { export type NextConfig = Record<string, any>; export type Metadata = Record<string, any> }
declare module 'swr' { const useSWR: (key: any, fetcher?: any, opts?: any) => { data: any; error: any; isLoading: boolean; mutate: (...a: any[]) => any; isValidating: boolean }; export default useSWR; export const mutate: (...a: any[]) => any }
declare module 'react' {
  export type ReactNode = any
  export type ReactElement = any
  export type FC<P = {}> = (props: P) => any
  export type CSSProperties = Record<string, any>
  export type ChangeEvent<T = any> = { target: T & { value: string; checked?: boolean; files?: FileList | null } }
  export type FormEvent<T = any> = { preventDefault(): void; currentTarget: T }
  export type MouseEvent<T = any> = { preventDefault(): void; stopPropagation(): void; currentTarget: T }
  export type KeyboardEvent<T = any> = { key: string; preventDefault(): void }
  export type Dispatch<A> = (a: A) => void
  export type SetStateAction<S> = S | ((s: S) => S)
  export type RefObject<T> = { current: T | null }
  export type ComponentProps<T> = any
  export function useState<S>(init: S | (() => S)): [S, Dispatch<SetStateAction<S>>]
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>]
  export function useEffect(fn: () => void | (() => void), deps?: any[]): void
  export function useLayoutEffect(fn: () => void | (() => void), deps?: any[]): void
  export function useMemo<T>(fn: () => T, deps: any[]): T
  export function useCallback<T extends (...a: any[]) => any>(fn: T, deps: any[]): T
  export function useRef<T>(init: T): { current: T }
  export function useRef<T>(init: T | null): RefObject<T>
  export function useRef<T = undefined>(): { current: T | undefined }
  export function useReducer(...a: any[]): any
  export function useContext<T>(c: any): T
  export function createContext<T>(v: T): any
  export function useTransition(): [boolean, (fn: () => void) => void]
  export function useId(): string
  export const Fragment: any
  export const Suspense: any
  export function createElement(...a: any[]): any
  const React: any
  export default React
  export namespace React { type FormEvent<T = any> = { preventDefault(): void; currentTarget: T }; type ChangeEvent<T = any> = { target: T & { value: string; checked?: boolean; files?: FileList | null } }; type ReactNode = any; type MouseEvent<T = any> = { preventDefault(): void; stopPropagation(): void }; type KeyboardEvent<T = any> = { key: string; preventDefault(): void }; type CSSProperties = Record<string, any> }
}
declare namespace React { type FormEvent<T = any> = { preventDefault(): void; currentTarget: T }; type ChangeEvent<T = any> = { target: T & { value: string; checked?: boolean; files?: FileList | null } }; type ReactNode = any; type MouseEvent<T = any> = { preventDefault(): void; stopPropagation(): void }; type KeyboardEvent<T = any> = { key: string; preventDefault(): void }; type CSSProperties = Record<string, any>; type ReactElement = any; type ButtonHTMLAttributes<T> = Record<string, any>; type AnchorHTMLAttributes<T> = Record<string, any>; type InputHTMLAttributes<T> = Record<string, any> }
declare module 'react/jsx-runtime' { export const jsx: any; export const jsxs: any; export const Fragment: any }
declare namespace JSX { interface IntrinsicElements { [el: string]: any } interface Element {} interface ElementChildrenAttribute { children: {} } interface IntrinsicAttributes { key?: any } }
declare module 'tailwindcss' { const t: any; export default t; export type Config = any }
declare module 'dotenv' { export function config(o?: any): any }
declare module 'dotenv/config' {}
declare module 'cheerio' { export function load(html: string, o?: any): any; export type CheerioAPI = any }
declare module 'fast-xml-parser' { export class XMLParser { constructor(o?: any); parse(s: string): any } }
declare module 'p-queue' { export default class PQueue { constructor(o?: any); add<T>(fn: () => Promise<T>): Promise<T>; onIdle(): Promise<void>; size: number; pending: number } }
declare module 'nodemailer' { const n: any; export default n; export type Transporter = any }
declare module 'playwright' { export const chromium: any; export type Browser = any; export type Page = any; export type BrowserContext = any }
declare module 'docx' { export const Document: any, Packer: any, Paragraph: any, TextRun: any, HeadingLevel: any, AlignmentType: any, TabStopType: any, BorderStyle: any, Table: any, TableRow: any, TableCell: any, WidthType: any, ExternalHyperlink: any, UnderlineType: any, LevelFormat: any; export type IParagraphOptions = any; export type ISectionOptions = any; export type IRunOptions = any }
declare module 'unpdf' { export function getDocumentProxy(d: Uint8Array): Promise<any>; export function getResolvedPDFJS(): Promise<any>; export function extractText(d: Uint8Array, o?: any): Promise<{ totalPages: number; text: string | string[] }> }
declare module 'mammoth' { const m: { extractRawText(i: { buffer: Buffer }): Promise<{ value: string; messages: any[] }>; convertToHtml(i: { buffer: Buffer }): Promise<{ value: string; messages: any[] }> }; export default m }
declare module '@aws-sdk/client-s3' { export class S3Client { constructor(o: any); send(c: any): Promise<any> } export class PutObjectCommand { constructor(i: any) } export class GetObjectCommand { constructor(i: any) } export class HeadObjectCommand { constructor(i: any) } export class DeleteObjectCommand { constructor(i: any) } export class DeleteObjectsCommand { constructor(i: any) } export class ListObjectsV2Command { constructor(i: any) } }
declare module '@aws-sdk/s3-request-presigner' { export function getSignedUrl(c: any, cmd: any, o?: any): Promise<string> }
declare module 'vitest' { export const describe: any, it: any, test: any, expect: any, beforeEach: any, afterEach: any, beforeAll: any, afterAll: any, vi: any }
declare module '@prisma/debug' { const d: any; export default d }
declare module 'pdfjs-dist/legacy/build/pdf.mjs' { const m: any; export = m }
declare module '*.css' {}
