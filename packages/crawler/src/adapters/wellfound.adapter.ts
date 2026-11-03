import type { RawJob, SourceConfig } from '../types.js'
import { BaseAdapter } from './base.adapter.js'

export class WellfoundAdapter extends BaseAdapter {
  readonly sourceName = 'Wellfound'

  availabilityIssue(_config: SourceConfig): string | null {
    return 'Public job pages are behind DataDome anti-bot protection; requires a session-based browser crawler.'
  }

  async fetch(_config: SourceConfig): Promise<RawJob[]> {
    return []
  }
}
