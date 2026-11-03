'use client'

import { AppShell } from '../layout/AppShell'
import { QueuesPanel } from '../QueuesPanel'
import { PageHeader } from '../ui'

export function QueuesAdminPage() {
  return (
    <AppShell title="Queues" subtitle="Depth, failures, retries">
      <PageHeader eyebrow="Admin" title="Queues" description="BullMQ queues for crawling and user tasks. Failed jobs keep their reason; retry or remove them here. Inline mode shows the in-process backlog." />
      <QueuesPanel />
    </AppShell>
  )
}
