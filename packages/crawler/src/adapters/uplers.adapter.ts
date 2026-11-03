import { BaseAdapter } from './base.adapter.js'
import type { RawJob, SourceConfig } from '../types.js'
import { log } from '@jobradar/log'

// platform.uplers.com uses a private authenticated API with no public docs.
// uplers.com/remote-jobs requires Playwright + auth session to scrape.
// Disabled until a working public endpoint or Playwright flow is implemented.
export class UplersAdapter extends BaseAdapter {
  readonly sourceName = 'Uplers'

  async fetch(_config: SourceConfig): Promise<RawJob[]> {
    log.info('[UplersAdapter] Disabled: private API requires authentication. Re-enable when public endpoint or Playwright scraper is implemented.')
    return []
  }
}
