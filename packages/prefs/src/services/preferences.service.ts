import type { Prisma, PrismaClient } from '@jobradar/db'
import { log } from '@jobradar/log'
import { PREFS_SCHEMA_VERSION, lintPreferences, parsePreferences, type Preferences } from '../schema.js'
import { SYSTEM_PRESETS, legacyDocFromEnv } from '../presets.js'

export interface SavedPreferences { doc: Preferences; version: number; source: string; updatedAt: Date; warnings: string[] }

/**
 * Stored preferences (HLD §5): one active document per user, append-only history, system + private presets.
 * Every save bumps `version`; evals record which version produced them so a re-evaluation can be idempotent.
 */
export class PreferencesService {
  constructor(private prisma: PrismaClient) {}

  /** Active doc, or null when the user has none yet (→ wizard). */
  async get(userId: string): Promise<SavedPreferences | null> {
    const row = await this.prisma.userPreferences.findUnique({ where: { userId } })
    if (!row) return null
    const doc = parsePreferences(row.doc)
    return { doc, version: row.version, source: row.source, updatedAt: row.updatedAt, warnings: lintPreferences(doc) }
  }

  /**
   * Ensure a doc exists. The deployment owner (first admin) is seeded from the pre-v5 env constants so the
   * upgrade is behaviour-preserving; everyone else starts from `legacy-india-remote`'s shape but with their
   * profile's skills/titles and no home (→ wizard asks).
   */
  async ensure(userId: string): Promise<SavedPreferences> {
    const existing = await this.get(userId)
    if (existing) return existing
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, createdAt: true } })
    const firstAdmin = await this.prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' }, select: { id: true } })
    const doc = firstAdmin?.id === userId || (user?.role === 'admin' && !firstAdmin) ? legacyDocFromEnv() : structuredClone(SYSTEM_PRESETS[0].doc)
    await this.seedRoleFromProfile(userId, doc)
    return this.save(userId, doc, { source: 'seed', note: firstAdmin?.id === userId ? 'seeded from env (legacy-india-remote)' : 'seeded from preset legacy-india-remote' })
  }

  /** Fill role skills/titles from the resume-derived profile when the doc has none. */
  async seedRoleFromProfile(userId: string, doc: Preferences): Promise<Preferences> {
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId }, select: { skills: true, targetTitles: true } })
    if (!profile) return doc
    const skills = ((profile.skills as Array<{ canonical?: string; name?: string }> | null) ?? []).map((s) => s.canonical ?? s.name ?? '').filter(Boolean)
    if (skills.length) doc.role.skills = [...new Set([...skills, ...doc.role.skills])].slice(0, 100)
    if (profile.targetTitles.length && !doc.role.targetTitles.length) doc.role.targetTitles = profile.targetTitles.slice(0, 20)
    return doc
  }

  /** Validate + persist a new version (history appended atomically). Returns the saved state. */
  async save(userId: string, input: unknown, opts: { source?: string; note?: string } = {}): Promise<SavedPreferences> {
    const doc = parsePreferences(input)
    const source = opts.source ?? 'manual'
    const row = await this.prisma.$transaction(async (tx) => {
      const cur = await tx.userPreferences.findUnique({ where: { userId } })
      const version = (cur?.version ?? 0) + 1
      const saved = await tx.userPreferences.upsert({
        where: { userId },
        create: { userId, doc: doc as unknown as Prisma.InputJsonValue, schemaVersion: PREFS_SCHEMA_VERSION, source, version },
        update: { doc: doc as unknown as Prisma.InputJsonValue, schemaVersion: PREFS_SCHEMA_VERSION, source, version },
      })
      await tx.preferenceHistory.create({ data: { userId, version, doc: doc as unknown as Prisma.InputJsonValue, source, note: opts.note ?? null } })
      return saved
    })
    log.info('preferences saved', { userId, version: row.version, source })
    return { doc, version: row.version, source, updatedAt: row.updatedAt, warnings: lintPreferences(doc) }
  }

  async history(userId: string, limit = 20) {
    const rows = await this.prisma.preferenceHistory.findMany({ where: { userId }, orderBy: { version: 'desc' }, take: limit, select: { id: true, version: true, source: true, note: true, changedAt: true } })
    return rows
  }

  /** Re-save an older version's document as a new version (history stays linear). */
  async revert(userId: string, version: number): Promise<SavedPreferences> {
    const row = await this.prisma.preferenceHistory.findUnique({ where: { userId_version: { userId, version } } })
    if (!row) throw new Error('Version not found')
    return this.save(userId, row.doc, { source: 'manual', note: `reverted to v${version}` })
  }

  // ── presets ──────────────────────────────────────────────────────────────────────────────────────────────
  /** System presets are upserted from code (single source of truth); private presets belong to one user. */
  async ensureSystemPresets(): Promise<void> {
    for (const p of SYSTEM_PRESETS) {
      const existing = await this.prisma.preferencePreset.findFirst({ where: { ownerUserId: null, name: p.name } })
      const data = { name: p.name, description: p.description, doc: p.doc as unknown as Prisma.InputJsonValue, schemaVersion: PREFS_SCHEMA_VERSION, ownerUserId: null }
      if (existing) await this.prisma.preferencePreset.update({ where: { id: existing.id }, data })
      else await this.prisma.preferencePreset.create({ data })
    }
  }

  async presets(userId: string) {
    const rows = await this.prisma.preferencePreset.findMany({ where: { OR: [{ ownerUserId: null }, { ownerUserId: userId }] }, orderBy: [{ ownerUserId: 'asc' }, { name: 'asc' }] })
    return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, system: r.ownerUserId === null, doc: r.doc as unknown as Preferences, createdAt: r.createdAt }))
  }

  async savePreset(userId: string, name: string, doc: unknown, description?: string) {
    const parsed = parsePreferences(doc)
    const n = name.trim().slice(0, 60)
    if (!n) throw new Error('Preset name required')
    const count = await this.prisma.preferencePreset.count({ where: { ownerUserId: userId } })
    const existing = await this.prisma.preferencePreset.findFirst({ where: { ownerUserId: userId, name: n } })
    if (!existing && count >= 20) throw new Error('At most 20 private presets')
    const data = { ownerUserId: userId, name: n, description: description?.slice(0, 200) ?? null, doc: parsed as unknown as Prisma.InputJsonValue, schemaVersion: PREFS_SCHEMA_VERSION }
    return existing ? this.prisma.preferencePreset.update({ where: { id: existing.id }, data }) : this.prisma.preferencePreset.create({ data })
  }

  async deletePreset(userId: string, id: string): Promise<boolean> {
    const r = await this.prisma.preferencePreset.deleteMany({ where: { id, ownerUserId: userId } }) // system presets cannot be deleted
    return r.count > 0
  }

  /**
   * Apply a preset: keeps the user's `home` (country/metros/timezone/currency) and role seed unless the preset
   * is applied with `replaceHome`, so "switch to EU remote" does not silently move someone to Berlin.
   */
  async applyPreset(userId: string, presetId: string, opts: { replaceHome?: boolean } = {}): Promise<SavedPreferences> {
    const preset = await this.prisma.preferencePreset.findFirst({ where: { id: presetId, OR: [{ ownerUserId: null }, { ownerUserId: userId }] } })
    if (!preset) throw new Error('Preset not found')
    const doc = parsePreferences(preset.doc)
    const cur = await this.get(userId)
    if (cur && !opts.replaceHome) {
      doc.home = cur.doc.home
      doc.pay.currency = cur.doc.pay.currency === doc.pay.currency ? doc.pay.currency : cur.doc.home.currency
      if (!doc.role.skills.length) doc.role.skills = cur.doc.role.skills
      if (!doc.role.targetTitles.length) doc.role.targetTitles = cur.doc.role.targetTitles
    }
    await this.seedRoleFromProfile(userId, doc)
    return this.save(userId, doc, { source: 'preset', note: `applied preset ${preset.name}` })
  }
}
