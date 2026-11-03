import { NextRequest } from 'next/server'
import { requireUser, unauthorized, Unauthorized } from '../../../../../lib/auth'
import { services } from '../../../../../lib/services'

export const dynamic = 'force-dynamic'

/**
 * Server-sent task progress (GH-1): one event per state change, `done`/`failed` closes the stream. Works in
 * both queue modes (reads TaskTracker, which is Redis- or memory-backed) and needs no pub/sub. The client
 * falls back to polling when EventSource is unavailable.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let userId: string
  try { userId = (await requireUser()).id } catch (err) { return err instanceof Unauthorized ? unauthorized() : new Response('error', { status: 500 }) }
  const { tasks } = services()
  const encoder = new TextEncoder()
  const maxMs = parseInt(process.env.TASK_STREAM_MAX_MS ?? '600000', 10)
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      const started = Date.now()
      let last = ''
      let missing = 0
      const tick = async (): Promise<boolean> => {
        const t = await tasks.get(id)
        if (!t || (t.userId && t.userId !== userId)) {
          if (++missing >= 4) { send('failed', { id, status: 'failed', error: 'task_lost' }); return false }
          return true
        }
        const sig = `${t.status}|${t.progress ?? ''}|${t.updatedAt}`
        if (sig !== last) { last = sig; send(t.status === 'done' || t.status === 'failed' ? t.status : 'progress', t) }
        return t.status !== 'done' && t.status !== 'failed'
      }
      try {
        send('open', { id })
        while (await tick()) {
          if (req.signal.aborted || Date.now() - started > maxMs) break
          await new Promise((r) => setTimeout(r, 700))
          if (Date.now() - started > 15_000 && (Date.now() - started) % 15_000 < 700) controller.enqueue(encoder.encode(': keepalive\n\n'))
        }
      } catch { /* client went away */ } finally {
        try { controller.close() } catch { /* already closed */ }
      }
    },
  })
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' } })
}
