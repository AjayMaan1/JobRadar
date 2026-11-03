import { redirect } from 'next/navigation'
import { currentUser } from '../../lib/auth'

/** Server-side gate for every /admin route (HLD-ui-v8 §1): non-admins are sent to the inbox. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser()
  if (!user) redirect('/login?next=/admin')
  if (user.role !== 'admin') redirect('/')
  return <>{children}</>
}
