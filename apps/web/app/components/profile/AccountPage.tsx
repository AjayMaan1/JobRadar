'use client'

import { useEffect, useState } from 'react'
import { AppShell } from '../layout/AppShell'
import { apiClient } from '../../../lib/api-client'
import { AccountSettings } from './AccountSettings'
import { PageHeader } from '../ui'

export function AccountPage() {
  const [me, setMe] = useState<{ email: string; role?: string } | null>(null)
  useEffect(() => { apiClient.getProfile().then((p) => setMe(p.user)).catch(() => setMe(null)) }, [])
  return (
    <AppShell title="Account" subtitle="Security, alerts, browser extension, your data">
      <PageHeader eyebrow="For you" title="Account & alerts" description="Password and sessions, where alerts are delivered, the browser extension pairing, and export or erase everything." />
      <AccountSettings email={me?.email ?? ''} isAdmin={me?.role === 'admin'} />
    </AppShell>
  )
}
