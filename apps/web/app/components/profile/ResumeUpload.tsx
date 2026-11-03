'use client'

import { useRef, useState } from 'react'
import { apiClient } from '../../../lib/api-client'
import { Icon } from '../ui/Icon'

export function ResumeUpload({ onUploaded }: { onUploaded: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [label, setLabel] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) { setError('Choose a PDF or DOCX file'); return }
    setBusy(true); setError(null); setProgress('Uploading…')
    try {
      const { taskId } = await apiClient.uploadResume(file, label || undefined)
      await onUploaded()
      const t = await apiClient.waitTask(taskId, (s) => setProgress(s.progress ?? (s.status === 'queued' ? 'Waiting for worker…' : 'Parsing…')))
      if (t.status === 'failed') setError(t.error ?? 'Parsing failed')
      else setProgress('Parsed ✓')
      await onUploaded()
      if (fileRef.current) fileRef.current.value = ''
      setFileName(null)
      setLabel('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
      setTimeout(() => setProgress(null), 3000)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center transition hover:border-indigo-300 hover:bg-indigo-50/40">
        <Icon name="upload" className="h-6 w-6 text-indigo-500" />
        <span className="text-sm font-medium text-slate-700">{fileName ?? 'Choose a PDF or DOCX'}</span>
        <span className="text-xs text-slate-400">{fileName ? 'Click to choose a different file' : 'or drop it here · up to 5 MB'}</span>
        <input ref={fileRef} type="file" className="sr-only" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)} accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
      </label>
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional), e.g. Backend – master" className="input" />
      <button disabled={busy} className="btn btn-primary btn-md w-full">{busy ? 'Working…' : 'Upload & parse'}</button>
      {progress && <p className="text-xs text-slate-500">{progress}</p>}
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <p className="text-xs text-slate-400">Your first upload becomes the master resume; later uploads are added alongside it.</p>
    </form>
  )
}
