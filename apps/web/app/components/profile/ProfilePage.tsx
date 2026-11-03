'use client'

import { useCallback, useEffect, useState } from 'react'
import { AppShell } from '../layout/AppShell'
import { apiClient } from '../../../lib/api-client'
import type { CandidateProfile } from '../../../lib/api-client'
import { ProfileEditor } from './ProfileEditor'
import { LinkButton, PageHeader } from '../ui'

/** Master profile: headline, about, target titles, skills, apply defaults. Never changed by tailoring. */
export function ProfilePage() {
  const [profile, setProfile] = useState<CandidateProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => { try { const p = await apiClient.getProfile(); setProfile(p.profile); setError(null) } catch (err) { setError((err as Error).message) } }, [])
  useEffect(() => { void refresh() }, [refresh])
  return (
    <AppShell title="Profile" subtitle="Your master headline, about, skills and apply defaults">
      <PageHeader eyebrow="For you" title="Profile" description="Seeded from your master resume; edit freely. Tailoring for a job never touches these texts — it only proposes per-application variants." actions={<LinkButton href="/preferences" icon="sliders">Match preferences</LinkButton>} />
      {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      <ProfileEditor profile={profile} onSaved={refresh} />
    </AppShell>
  )
}
