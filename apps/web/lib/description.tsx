import type { ReactNode } from 'react'

/**
 * Job descriptions are stored as structured plain text ("# Heading", "- bullet", paragraphs) since the
 * stripHtml fix. Render that structure instead of a single grey blob; legacy one-line descriptions still work.
 */
export function renderDescription(text: string | null | undefined): ReactNode {
  if (!text) return <p className="text-sm text-slate-400">No description available.</p>
  const lines = text.replace(/<[^>]+>/g, ' ').split(/\r?\n/)
  const out: ReactNode[] = []
  let para: string[] = []
  let list: string[] = []
  const flushPara = () => { if (para.length) { out.push(<p key={out.length} className="text-sm leading-relaxed text-slate-700">{para.join(' ')}</p>); para = [] } }
  const flushList = () => { if (list.length) { out.push(<ul key={out.length} className="list-disc space-y-0.5 pl-5 text-sm leading-relaxed text-slate-700">{list.map((l, i) => <li key={i}>{l}</li>)}</ul>); list = [] } }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) { flushPara(); flushList(); continue }
    if (/^#+\s+/.test(line)) { flushPara(); flushList(); out.push(<h4 key={out.length} className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{line.replace(/^#+\s+/, '')}</h4>); continue }
    if (/^[-•*▪◦]\s+/.test(line)) { flushPara(); list.push(line.replace(/^[-•*▪◦]\s+/, '')); continue }
    if (line.length < 60 && /:$/.test(line) && !/[.,;]/.test(line.slice(0, -1))) { flushPara(); flushList(); out.push(<h4 key={out.length} className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{line.slice(0, -1)}</h4>); continue }
    flushList(); para.push(line)
  }
  flushPara(); flushList()
  return <div className="space-y-2">{out}</div>
}
