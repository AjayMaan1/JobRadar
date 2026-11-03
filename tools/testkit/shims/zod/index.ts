/**
 * Sandbox shim for `zod` (subset used by JobRadar): object/array/string/number/boolean/enum/literal/record,
 * optional/nullable/default/catch/min/max/regex/trim/toLowerCase/or/describe, deepPartial, parse/safeParse,
 * z.infer. Semantics follow zod v3 closely enough for the offline test harness; never ship this.
 */
export interface ZodIssue { path: (string | number)[]; message: string }
export class ZodError extends Error {
  constructor(readonly issues: ZodIssue[]) {
    super(issues.map((i) => `${i.path.join('.') || '$'}: ${i.message}`).join('; '))
    this.name = 'ZodError'
  }
}
export type ZodTypeDef = Record<string, unknown>
type Ctx = { path: (string | number)[]; issues: ZodIssue[] }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ZodTypeAny = ZodType<any, any, any>
const INVALID = Symbol('invalid')

export abstract class ZodType<Output = unknown, Def extends ZodTypeDef = ZodTypeDef, Input = Output> {
  readonly _output!: Output
  readonly _input!: Input
  _def: Def & { typeName: string; description?: string }
  constructor(def: Def & { typeName: string }) { this._def = def }
  abstract _parse(v: unknown, ctx: Ctx): Output | typeof INVALID

  parse(v: unknown): Output {
    const ctx: Ctx = { path: [], issues: [] }
    const r = this._parse(v, ctx)
    if (ctx.issues.length) throw new ZodError(ctx.issues)
    return r as Output
  }
  safeParse(v: unknown): { success: true; data: Output } | { success: false; error: ZodError } {
    const ctx: Ctx = { path: [], issues: [] }
    const r = this._parse(v, ctx)
    if (ctx.issues.length) return { success: false, error: new ZodError(ctx.issues) }
    return { success: true, data: r as Output }
  }
  optional(): ZodOptional<Output, Input> { return new ZodOptional(this) }
  nullable(): ZodNullable<Output, Input> { return new ZodNullable(this) }
  nullish(): ZodOptional<Output | null, Input | null> { return new ZodOptional(new ZodNullable(this)) }
  default(d: NoUndefined<Input> | NoUndefined<Output> | (() => NoUndefined<Input> | NoUndefined<Output>)): ZodDefault<Output, Input> { return new ZodDefault(this, d) }
  catch(d: Output | (() => Output)): ZodCatch<Output> { return new ZodCatch(this, d) }
  or<U extends ZodTypeAny>(other: U): ZodUnion<Output | U['_output'], Input | U['_input']> { return new ZodUnion([this, other]) }
  describe(d: string): this { this._def.description = d; return this }
  refine(check: (v: Output) => boolean, message = 'Invalid'): this {
    const self = this
    const inner = self._parse.bind(self)
    self._parse = (v, ctx) => { const r = inner(v, ctx); if (r !== INVALID && !check(r as Output)) { ctx.issues.push({ path: [...ctx.path], message }); return INVALID } return r }
    return self
  }
  transform<U>(fn: (v: Output) => U): ZodEffects<U, Input> { return new ZodEffects(this, fn) }
}
type NoUndefined<T> = T extends undefined ? never : T

function fail(ctx: Ctx, message: string): typeof INVALID { ctx.issues.push({ path: [...ctx.path], message }); return INVALID }

export class ZodString extends ZodType<string, ZodTypeDef, string> {
  private checks: Array<(s: string, ctx: Ctx) => string | typeof INVALID> = []
  constructor() { super({ typeName: 'ZodString' }) }
  _parse(v: unknown, ctx: Ctx) {
    if (typeof v !== 'string') return fail(ctx, `Expected string, received ${v === null ? 'null' : typeof v}`)
    let s: string = v
    for (const c of this.checks) { const r = c(s, ctx); if (r === INVALID) return INVALID; s = r }
    return s
  }
  private add(c: (s: string, ctx: Ctx) => string | typeof INVALID): this { this.checks.push(c); return this }
  min(n: number, msg?: string) { return this.add((s, ctx) => (s.length >= n ? s : fail(ctx, msg ?? `String must contain at least ${n} character(s)`))) }
  max(n: number, msg?: string) { return this.add((s, ctx) => (s.length <= n ? s : fail(ctx, msg ?? `String must contain at most ${n} character(s)`))) }
  length(n: number, msg?: string) { return this.add((s, ctx) => (s.length === n ? s : fail(ctx, msg ?? `String must contain exactly ${n} character(s)`))) }
  regex(re: RegExp, msg?: string) { return this.add((s, ctx) => (re.test(s) ? s : fail(ctx, msg ?? 'Invalid'))) }
  email(msg?: string) { return this.regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, msg ?? 'Invalid email') }
  url(msg?: string) { return this.add((s, ctx) => { try { new URL(s); return s } catch { return fail(ctx, msg ?? 'Invalid url') } }) }
  trim() { return this.add((s) => s.trim()) }
  toLowerCase() { return this.add((s) => s.toLowerCase()) }
  toUpperCase() { return this.add((s) => s.toUpperCase()) }
}

export class ZodNumber extends ZodType<number, ZodTypeDef, number> {
  private checks: Array<(n: number, ctx: Ctx) => number | typeof INVALID> = []
  constructor() { super({ typeName: 'ZodNumber' }) }
  _parse(v: unknown, ctx: Ctx) {
    if (typeof v !== 'number' || Number.isNaN(v)) return fail(ctx, `Expected number, received ${v === null ? 'null' : typeof v}`)
    for (const c of this.checks) if (c(v, ctx) === INVALID) return INVALID
    return v
  }
  private add(c: (n: number, ctx: Ctx) => number | typeof INVALID): this { this.checks.push(c); return this }
  min(n: number, msg?: string) { return this.add((x, ctx) => (x >= n ? x : fail(ctx, msg ?? `Number must be greater than or equal to ${n}`))) }
  max(n: number, msg?: string) { return this.add((x, ctx) => (x <= n ? x : fail(ctx, msg ?? `Number must be less than or equal to ${n}`))) }
  int(msg?: string) { return this.add((x, ctx) => (Number.isInteger(x) ? x : fail(ctx, msg ?? 'Expected integer'))) }
  positive(msg?: string) { return this.add((x, ctx) => (x > 0 ? x : fail(ctx, msg ?? 'Number must be greater than 0'))) }
  nonnegative(msg?: string) { return this.add((x, ctx) => (x >= 0 ? x : fail(ctx, msg ?? 'Number must be greater than or equal to 0'))) }
}

export class ZodBoolean extends ZodType<boolean, ZodTypeDef, boolean> {
  constructor() { super({ typeName: 'ZodBoolean' }) }
  _parse(v: unknown, ctx: Ctx) { return typeof v === 'boolean' ? v : fail(ctx, `Expected boolean, received ${typeof v}`) }
}

export class ZodLiteral<T extends string | number | boolean> extends ZodType<T, ZodTypeDef, T> {
  constructor(readonly value: T) { super({ typeName: 'ZodLiteral' }) }
  _parse(v: unknown, ctx: Ctx) { return v === this.value ? (v as T) : fail(ctx, `Invalid literal value, expected ${JSON.stringify(this.value)}`) }
}

export class ZodEnum<T extends readonly [string, ...string[]]> extends ZodType<T[number], ZodTypeDef, T[number]> {
  constructor(readonly options: T) { super({ typeName: 'ZodEnum' }) }
  _parse(v: unknown, ctx: Ctx) { return typeof v === 'string' && (this.options as readonly string[]).includes(v) ? (v as T[number]) : fail(ctx, `Invalid enum value. Expected ${this.options.map((o) => `'${o}'`).join(' | ')}, received ${JSON.stringify(v)}`) }
}

export class ZodArray<T extends ZodTypeAny> extends ZodType<T['_output'][], ZodTypeDef, T['_input'][]> {
  private minLen: number | null = null
  private maxLen: number | null = null
  constructor(readonly element: T) { super({ typeName: 'ZodArray' }) }
  _parse(v: unknown, ctx: Ctx) {
    if (!Array.isArray(v)) return fail(ctx, `Expected array, received ${v === null ? 'null' : typeof v}`)
    if (this.minLen !== null && v.length < this.minLen) return fail(ctx, `Array must contain at least ${this.minLen} element(s)`)
    if (this.maxLen !== null && v.length > this.maxLen) return fail(ctx, `Array must contain at most ${this.maxLen} element(s)`)
    const out: unknown[] = []
    let bad = false
    v.forEach((item, i) => {
      ctx.path.push(i)
      const r = this.element._parse(item, ctx)
      ctx.path.pop()
      if (r === INVALID) bad = true
      else out.push(r)
    })
    return bad ? INVALID : (out as T['_output'][])
  }
  min(n: number) { this.minLen = n; return this }
  max(n: number) { this.maxLen = n; return this }
  nonempty() { return this.min(1) }
}

type Shape = Record<string, ZodTypeAny>
type OptionalKeys<S extends Shape> = { [K in keyof S]: undefined extends S[K]['_output'] ? K : never }[keyof S]
type RequiredKeys<S extends Shape> = Exclude<keyof S, OptionalKeys<S>>
type Flatten<T> = { [K in keyof T]: T[K] }
export type ObjectOutput<S extends Shape> = Flatten<{ [K in RequiredKeys<S>]: S[K]['_output'] } & { [K in OptionalKeys<S>]?: S[K]['_output'] }>
type InputOptionalKeys<S extends Shape> = { [K in keyof S]: undefined extends S[K]['_input'] ? K : never }[keyof S]
export type ObjectInput<S extends Shape> = Flatten<{ [K in Exclude<keyof S, InputOptionalKeys<S>>]: S[K]['_input'] } & { [K in InputOptionalKeys<S>]?: S[K]['_input'] }>

export class ZodObject<S extends Shape> extends ZodType<ObjectOutput<S>, ZodTypeDef, ObjectInput<S>> {
  private mode: 'strip' | 'passthrough' | 'strict' = 'strip'
  constructor(readonly shape: S) { super({ typeName: 'ZodObject' }) }
  _parse(v: unknown, ctx: Ctx) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(ctx, `Expected object, received ${v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v}`)
    const obj = v as Record<string, unknown>
    const out: Record<string, unknown> = this.mode === 'passthrough' ? { ...obj } : {}
    let bad = false
    for (const key of Object.keys(this.shape)) {
      ctx.path.push(key)
      const r = this.shape[key]._parse(obj[key], ctx)
      ctx.path.pop()
      if (r === INVALID) bad = true
      else if (r !== undefined || key in obj) out[key] = r
    }
    if (this.mode === 'strict') for (const k of Object.keys(obj)) if (!(k in this.shape)) { fail(ctx, `Unrecognized key: '${k}'`); bad = true }
    return bad ? INVALID : (out as ObjectOutput<S>)
  }
  passthrough() { this.mode = 'passthrough'; return this }
  strict() { this.mode = 'strict'; return this }
  strip() { this.mode = 'strip'; return this }
  extend<E extends Shape>(e: E): ZodObject<Omit<S, keyof E> & E> { return new ZodObject({ ...this.shape, ...e } as Omit<S, keyof E> & E) }
  pick<K extends keyof S>(keys: Record<K, true>): ZodObject<Pick<S, K>> { const s: Partial<S> = {}; for (const k of Object.keys(keys) as K[]) s[k] = this.shape[k]; return new ZodObject(s as Pick<S, K>) }
  omit<K extends keyof S>(keys: Record<K, true>): ZodObject<Omit<S, K>> { const s = { ...this.shape }; for (const k of Object.keys(keys)) delete (s as Record<string, unknown>)[k]; return new ZodObject(s as unknown as Omit<S, K>) }
  partial(): ZodObject<{ [K in keyof S]: ZodOptional<S[K]['_output'], S[K]['_input']> }> { const s: Record<string, ZodTypeAny> = {}; for (const k of Object.keys(this.shape)) s[k] = this.shape[k].optional(); return new ZodObject(s) as never }
  deepPartial(): ZodObject<{ [K in keyof S]: ZodOptional<DeepPartial<S[K]['_output']>, DeepPartial<S[K]['_input']>> }> {
    const s: Record<string, ZodTypeAny> = {}
    for (const k of Object.keys(this.shape)) s[k] = deepPartialOf(this.shape[k]).optional()
    return new ZodObject(s) as never
  }
}
export type DeepPartial<T> = T extends (infer U)[] ? DeepPartial<U>[] : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T
function deepPartialOf(t: ZodTypeAny): ZodTypeAny {
  const inner = unwrap(t)
  if (inner instanceof ZodObject) return inner.deepPartial()
  if (inner instanceof ZodArray) return new ZodArray(deepPartialOf(inner.element))
  return inner
}
function unwrap(t: ZodTypeAny): ZodTypeAny {
  let cur: ZodTypeAny = t
  for (;;) {
    if (cur instanceof ZodOptional || cur instanceof ZodNullable || cur instanceof ZodDefault || cur instanceof ZodCatch) cur = cur.inner
    else return cur
  }
}

export class ZodRecord<V extends ZodTypeAny> extends ZodType<Record<string, V['_output']>, ZodTypeDef, Record<string, V['_input']>> {
  constructor(readonly value: V) { super({ typeName: 'ZodRecord' }) }
  _parse(v: unknown, ctx: Ctx) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(ctx, 'Expected object')
    const out: Record<string, unknown> = {}
    let bad = false
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      ctx.path.push(k)
      const r = this.value._parse(val, ctx)
      ctx.path.pop()
      if (r === INVALID) bad = true
      else out[k] = r
    }
    return bad ? INVALID : (out as Record<string, V['_output']>)
  }
}

export class ZodOptional<O, I = O> extends ZodType<O | undefined, ZodTypeDef, I | undefined> {
  constructor(readonly inner: ZodTypeAny) { super({ typeName: 'ZodOptional' }) }
  _parse(v: unknown, ctx: Ctx) { return v === undefined ? undefined : this.inner._parse(v, ctx) }
  unwrap() { return this.inner }
}
export class ZodNullable<O, I = O> extends ZodType<O | null, ZodTypeDef, I | null> {
  constructor(readonly inner: ZodTypeAny) { super({ typeName: 'ZodNullable' }) }
  _parse(v: unknown, ctx: Ctx) { return v === null ? null : this.inner._parse(v, ctx) }
  unwrap() { return this.inner }
}
export class ZodDefault<O, I = O> extends ZodType<NoUndefined<O>, ZodTypeDef, I | undefined> {
  constructor(readonly inner: ZodTypeAny, readonly defaultValue: unknown) { super({ typeName: 'ZodDefault' }) }
  _parse(v: unknown, ctx: Ctx) {
    const d = typeof this.defaultValue === 'function' ? (this.defaultValue as () => unknown)() : this.defaultValue
    return this.inner._parse(v === undefined ? clone(d) : v, ctx) as NoUndefined<O>
  }
  removeDefault() { return this.inner }
}
export class ZodCatch<O> extends ZodType<O, ZodTypeDef, unknown> {
  constructor(readonly inner: ZodTypeAny, readonly catchValue: unknown) { super({ typeName: 'ZodCatch' }) }
  _parse(v: unknown, ctx: Ctx) {
    const sub: Ctx = { path: [...ctx.path], issues: [] }
    const r = this.inner._parse(v, sub)
    if (sub.issues.length || r === INVALID) return clone(typeof this.catchValue === 'function' ? (this.catchValue as () => unknown)() : this.catchValue) as O
    return r as O
  }
}
export class ZodUnion<O, I = O> extends ZodType<O, ZodTypeDef, I> {
  constructor(readonly options: ZodTypeAny[]) { super({ typeName: 'ZodUnion' }) }
  _parse(v: unknown, ctx: Ctx) {
    for (const o of this.options) {
      const sub: Ctx = { path: [...ctx.path], issues: [] }
      const r = o._parse(v, sub)
      if (!sub.issues.length && r !== INVALID) return r as O
    }
    return fail(ctx, 'Invalid input')
  }
}
export class ZodEffects<U, I = unknown> extends ZodType<U, ZodTypeDef, I> {
  constructor(readonly inner: ZodTypeAny, readonly fn: (v: any) => U) { super({ typeName: 'ZodEffects' }) } // eslint-disable-line @typescript-eslint/no-explicit-any
  _parse(v: unknown, ctx: Ctx) { const r = this.inner._parse(v, ctx); return r === INVALID ? INVALID : this.fn(r) }
}
export class ZodTuple<T extends ZodTypeAny[]> extends ZodType<{ [K in keyof T]: T[K]['_output'] }, ZodTypeDef, { [K in keyof T]: T[K]['_input'] }> {
  constructor(readonly items: T) { super({ typeName: 'ZodTuple' }) }
  _parse(v: unknown, ctx: Ctx): { [K in keyof T]: T[K]['_output'] } | typeof INVALID {
    if (!Array.isArray(v)) return fail(ctx, 'Expected array')
    if (v.length !== this.items.length) return fail(ctx, `Expected ${this.items.length} element(s)`)
    const out: unknown[] = []
    let bad = false
    this.items.forEach((it, i) => { ctx.path.push(i); const r = it._parse(v[i], ctx); ctx.path.pop(); if (r === INVALID) bad = true; else out.push(r) })
    return (bad ? INVALID : out) as never
  }
}
export class ZodUnknown extends ZodType<unknown> { constructor() { super({ typeName: 'ZodUnknown' }) } _parse(v: unknown) { return v } }
export class ZodAny extends ZodType<any> { constructor() { super({ typeName: 'ZodAny' }) } _parse(v: unknown) { return v } } // eslint-disable-line @typescript-eslint/no-explicit-any

function clone<T>(v: T): T { return v !== null && typeof v === 'object' ? (JSON.parse(JSON.stringify(v)) as T) : v }

export const z = {
  string: () => new ZodString(),
  number: () => new ZodNumber(),
  boolean: () => new ZodBoolean(),
  literal: <T extends string | number | boolean>(v: T) => new ZodLiteral(v),
  enum: <const T extends readonly [string, ...string[]]>(opts: T) => new ZodEnum(opts),
  array: <T extends ZodTypeAny>(el: T) => new ZodArray(el),
  object: <S extends Shape>(shape: S) => new ZodObject(shape),
  record: <V extends ZodTypeAny>(value: V) => new ZodRecord(value),
  tuple: <T extends ZodTypeAny[]>(items: [...T]) => new ZodTuple(items),
  union: <T extends ZodTypeAny>(opts: T[]) => new ZodUnion<T['_output'], T['_input']>(opts),
  optional: <T extends ZodTypeAny>(t: T) => t.optional(),
  nullable: <T extends ZodTypeAny>(t: T) => t.nullable(),
  unknown: () => new ZodUnknown(),
  any: () => new ZodAny(),
  ZodError,
}
export namespace z {
  export type infer<T extends ZodTypeAny> = T['_output']
  export type input<T extends ZodTypeAny> = T['_input']
  export type output<T extends ZodTypeAny> = T['_output']
  export type ZodTypeAny = ZodType<any, any, any> // eslint-disable-line @typescript-eslint/no-explicit-any
}
export type ZodSchema<T = unknown> = ZodType<T, ZodTypeDef, unknown>
export default z
