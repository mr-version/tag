import * as exec from '@actions/exec'

export interface HistoryInfo {
  /** Top-level directory of the git repository that contains repository-path. */
  gitRoot: string
  shallow: boolean
  /** Number of version tags (tag-prefix followed by a digit, optionally after "project/") reachable from HEAD. */
  reachableVersionTags: number
  /** Number of tags in the repository. */
  totalTags: number
}

export interface HistoryVerdict {
  level: 'ok' | 'notice' | 'warning' | 'error'
  message?: string
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Counts tags that look like version tags: "<prefix><digit>..." or "<project>/<prefix><digit>...". */
export function countVersionTags(tags: string[], tagPrefix: string): number {
  const pattern = new RegExp(`(^|/)${escapeRegExp(tagPrefix)}\\d`)
  return tags.filter(tag => pattern.test(tag.trim())).length
}

/**
 * Decides whether the clone has enough history to calculate versions. A shallow clone (actions/checkout's
 * default fetch-depth: 1) hides the tags and commits mr-version needs, which silently turns every project
 * into 0.1.0, so it is an error unless allowShallow is set.
 */
export function evaluateHistory(info: HistoryInfo, allowShallow: boolean): HistoryVerdict {
  if (info.shallow) {
    const tagState = info.reachableVersionTags === 0
      ? 'no version tag is reachable from HEAD'
      : `only part of the history is present (${info.reachableVersionTags} version tag(s) reachable from HEAD)`
    const message =
      `The repository at '${info.gitRoot}' is a shallow clone and ${tagState}, so versions would be calculated ` +
      `from incomplete history (typically every project becomes 0.1.0). Fetch the full history and tags, e.g. ` +
      `actions/checkout with 'fetch-depth: 0' (or run 'git fetch --unshallow --tags')` +
      (allowShallow ? '.' : `, or set 'allow-shallow: true' to calculate anyway.`)
    return { level: allowShallow ? 'warning' : 'error', message }
  }

  if (info.totalTags === 0) {
    return {
      level: 'notice',
      message:
        `No tags found in '${info.gitRoot}': all projects start from their base version. If this repository ` +
        `already has releases, make sure tags are fetched (actions/checkout with 'fetch-depth: 0' fetches them).`
    }
  }

  return { level: 'ok' }
}

async function git(args: string[], cwd: string): Promise<exec.ExecOutput> {
  return exec.getExecOutput('git', args, { cwd, silent: true, ignoreReturnCode: true })
}

export async function inspectHistory(repositoryRoot: string, tagPrefix: string): Promise<HistoryInfo> {
  const topLevel = await git(['rev-parse', '--show-toplevel'], repositoryRoot)
  if (topLevel.exitCode !== 0) {
    throw new Error(
      `repository-path '${repositoryRoot}' is not inside a git repository: ${(topLevel.stderr || topLevel.stdout).trim()}`
    )
  }
  const gitRoot = topLevel.stdout.trim()

  const shallowOutput = await git(['rev-parse', '--is-shallow-repository'], repositoryRoot)
  const shallow = shallowOutput.exitCode === 0 && shallowOutput.stdout.trim() === 'true'

  const allTags = await git(['tag', '--list'], repositoryRoot)
  const totalTags = allTags.exitCode === 0 ? allTags.stdout.split('\n').filter(t => t.trim()).length : 0

  const merged = await git(['tag', '--merged', 'HEAD'], repositoryRoot)
  const reachableVersionTags = merged.exitCode === 0 ? countVersionTags(merged.stdout.split('\n'), tagPrefix) : 0

  return { gitRoot, shallow, reachableVersionTags, totalTags }
}
