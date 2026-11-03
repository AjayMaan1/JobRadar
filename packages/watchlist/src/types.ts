import type { RawJob, BoardItem } from '@jobradar/crawler'

/** Payload of an `enrich` queue job. One per new/changed sighting. */
export interface EnrichPayload {
  feedKey: string
  boardId?: string | null
  sourceId?: string | null
  externalId: string
  raw: RawJob
  item?: BoardItem | null
  companyId?: string | null
  suppressAlerts?: boolean
  firstSeenAt?: string | null
  isRemoteFlag?: boolean | null
  employmentTypeHints?: string[]
  /** 'new' | 'changed' | 'reappeared' */
  event: 'new' | 'changed' | 'reappeared'
}

export interface PollOutcome {
  boardId: string
  outcome: string
  newCount: number
  changedCount: number
  goneCount: number
  closedCount: number
  enrich: EnrichPayload[]
  nextPollAt: Date
  error?: string
}
