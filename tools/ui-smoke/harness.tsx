/**
 * Browser entry for the UI smoke run: mounts the real page components (apps/web/app/components) by pathname,
 * exactly as the Next.js routes would. The API is the real set of route handlers, bridged by tools/ui-smoke/server.ts.
 */
import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { JobsWorkspace } from '../../apps/web/app/components/jobs/JobsWorkspace'
import { ApplicationsPage } from '../../apps/web/app/components/jobs/ApplicationsPage'
import { ResumesPage } from '../../apps/web/app/components/profile/ResumesPage'
import { ProfilePage } from '../../apps/web/app/components/profile/ProfilePage'
import { AccountPage } from '../../apps/web/app/components/profile/AccountPage'
import { PreferencesPage } from '../../apps/web/app/components/preferences/PreferencesPage'
import { OverviewPage } from '../../apps/web/app/components/admin/OverviewPage'
import { CompaniesPage } from '../../apps/web/app/components/admin/CompaniesPage'
import { SourcesPage } from '../../apps/web/app/components/admin/SourcesPage'
import { QueuesAdminPage as QueuesPage } from '../../apps/web/app/components/admin/QueuesPage'
import { ResumeEditorPage } from '../../apps/web/app/components/editor/ResumeEditorPage'
import LoginPage from '../../apps/web/app/login/page'

function route(path: string) {
  if (path === '/') return <JobsWorkspace />
  if (path === '/applications') return <ApplicationsPage />
  if (path === '/resumes') return <ResumesPage />
  if (path === '/profile') return <ProfilePage />
  if (path === '/account') return <AccountPage />
  if (path === '/preferences') return <PreferencesPage />
  if (path === '/admin') return <OverviewPage />
  if (path === '/admin/companies') return <CompaniesPage />
  if (path === '/admin/sources') return <SourcesPage />
  if (path === '/admin/queues') return <QueuesPage />
  if (path === '/login') return <LoginPage />
  const m = path.match(/^\/resumes\/([^/]+)\/edit$/)
  if (m) return <Suspense fallback={null}><ResumeEditorPage resumeId={m[1]} /></Suspense>
  return <div data-smoke="404">No route for {path}</div>
}

createRoot(document.getElementById('root')!).render(<StrictMode>{route(window.location.pathname)}</StrictMode>)
