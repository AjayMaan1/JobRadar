/** HTML → PDF. The worker provides a Playwright-backed implementation; tests can stub it. */
export interface PdfRenderer {
  htmlToPdf(html: string): Promise<Buffer>
  close(): Promise<void>
}

type Browser = { newContext(o?: unknown): Promise<{ newPage(): Promise<{ setContent(html: string, o?: unknown): Promise<void>; pdf(o?: unknown): Promise<Buffer> }>; close(): Promise<void> }>; close(): Promise<void>; isConnected?(): boolean }

/**
 * Shared Chromium instance (backlog C3-7): launched lazily on first render, one context per job, closed on
 * shutdown. `playwright` is loaded dynamically so environments without a browser can still import this module
 * (they get a clear error at render time: run `npx playwright install chromium`).
 */
export class PlaywrightPdfRenderer implements PdfRenderer {
  private browser: Promise<Browser> | null = null
  private inflight = 0

  constructor(private opts: { maxConcurrent?: number; timeoutMs?: number } = {}) {}

  private async launch(): Promise<Browser> {
    if (!this.browser) {
      this.browser = (async () => {
        const pw = (await import('playwright')) as unknown as { chromium: { launch(o?: unknown): Promise<Browser> } }
        return pw.chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
      })().catch((err) => {
        this.browser = null
        throw new Error(`PDF renderer unavailable: ${(err as Error).message}. Install with: npx playwright install chromium`)
      })
    }
    return this.browser
  }

  async htmlToPdf(html: string): Promise<Buffer> {
    const max = this.opts.maxConcurrent ?? 2
    while (this.inflight >= max) await new Promise((r) => setTimeout(r, 100))
    this.inflight++
    try {
      const browser = await this.launch()
      const ctx = await browser.newContext({ javaScriptEnabled: false })
      try {
        const page = await ctx.newPage()
        await page.setContent(html, { waitUntil: 'load', timeout: this.opts.timeoutMs ?? 30_000 })
        const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true })
        return Buffer.from(pdf)
      } finally {
        await ctx.close()
      }
    } finally {
      this.inflight--
    }
  }

  async close(): Promise<void> {
    const b = await this.browser?.catch(() => null)
    this.browser = null
    await b?.close().catch(() => undefined)
  }
}
