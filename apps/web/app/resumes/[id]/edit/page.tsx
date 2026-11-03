import { Suspense } from 'react'
import { ResumeEditorPage } from '../../../components/editor/ResumeEditorPage'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Suspense fallback={null}>
      <ResumeEditorPage resumeId={id} />
    </Suspense>
  )
}
