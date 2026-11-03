import type { RawJob, SourceConfig } from '../types.js'
import { BaseAdapter } from './base.adapter.js'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { log } from '@jobradar/log'

const execFileAsync = promisify(execFile)
const EVER_JOBS_CLI_RELATIVE_PATH = 'dist/apps/cli/main.js'

function uniquePaths(paths: string[]) {
  return [...new Set(paths.map((path) => path.trim()).filter(Boolean))]
}

function resolveEverJobsRepoPath() {
  const candidates = uniquePaths([
    process.env.EVER_JOBS_PATH ?? '',
    resolve(process.cwd(), '../ever-jobs'),
    resolve(process.cwd(), 'ever-jobs'),
    resolve(process.cwd(), '../../ever-jobs'),
    resolve(process.cwd(), '../../../ever-jobs'),
  ])

  const repoPath = candidates.find((candidate) => existsSync(candidate))
  if (!repoPath) {
    throw new Error(
      `EverJobs repository not found. Set EVER_JOBS_PATH or clone ever-jobs into one of: ${candidates.join(', ')}`
    )
  }

  return repoPath
}

function resolveEverJobsCliPath() {
  const repoPath = resolveEverJobsRepoPath()
  const cliPath = resolve(repoPath, EVER_JOBS_CLI_RELATIVE_PATH)

  if (!existsSync(cliPath)) {
    throw new Error(
      `EverJobs CLI build not found at ${cliPath}. Build the ever-jobs repository before crawling Ever Jobs.`
    )
  }

  return { repoPath, cliPath }
}

export class EverJobsAdapter extends BaseAdapter {
  readonly sourceName = 'Ever Jobs'

  availabilityIssue(_config: SourceConfig): string | null {
    try {
      resolveEverJobsCliPath()
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }

  async fetch(config: SourceConfig): Promise<RawJob[]> {
    const { repoPath: everJobsPath, cliPath } = resolveEverJobsCliPath()

    try {
      const { stdout, stderr } = await execFileAsync(
        'node',
        [cliPath, 'search', '-q', 'Software Engineer', '--remote', '-f', 'json', '--limit', '100'],
        { cwd: everJobsPath, maxBuffer: 20 * 1024 * 1024 }
      )
      if (stderr) log.warn('EverJobsAdapter stderr:', stderr.slice(0, 500))

      // Output may have log lines before the JSON array
      const jsonStart = stdout.indexOf('[')
      const jsonEnd = stdout.lastIndexOf(']')
      if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
        throw new Error('EverJobs CLI did not emit a JSON array')
      }

      const rawJson = stdout.substring(jsonStart, jsonEnd + 1)
      const results = JSON.parse(rawJson)

      if (!Array.isArray(results)) {
        throw new Error('EverJobs CLI output was not a JSON array')
      }

      return results.map((j: any) => ({
        title: j.title || 'Untitled Role',
        company: j.company || 'Unknown Company',
        applyUrl: j.url || j.link || '',
        sourceUrl: j.url || j.link || '',
        description: j.description || '',
        location: j.location || 'Remote',
        sourceFingerprint: `everjobs-${j.id || j.url || `${j.company}-${j.title}`}`,
        sourceName: this.sourceName,
        tags: Array.isArray(j.tags) ? j.tags : [],
      }))
    } catch (err) {
      throw new Error(
        `EverJobsAdapter fetch failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
}
