import type { KnownAts } from '../ats-urls.js'
import type { BoardEngine } from './types.js'
import { GreenhouseEngine } from './greenhouse.engine.js'
import { LeverEngine } from './lever.engine.js'
import { AshbyEngine } from './ashby.engine.js'
import { WorkableEngine } from './workable.engine.js'
import { SmartRecruitersEngine } from './smartrecruiters.engine.js'
import { WorkdayEngine } from './workday.engine.js'
import { RecruiteeEngine, TeamtailorEngine } from './recruitee-teamtailor.engine.js'

const ENGINES: Partial<Record<KnownAts, BoardEngine>> = {
  greenhouse: new GreenhouseEngine(),
  lever: new LeverEngine(),
  ashby: new AshbyEngine(),
  workable: new WorkableEngine(),
  smartrecruiters: new SmartRecruitersEngine(),
  workday: new WorkdayEngine(),
  recruitee: new RecruiteeEngine(),
  teamtailor: new TeamtailorEngine(),
}

export function engineFor(ats: string): BoardEngine | null {
  return ENGINES[ats as KnownAts] ?? null
}

export function supportedAts(): KnownAts[] {
  return Object.keys(ENGINES) as KnownAts[]
}
