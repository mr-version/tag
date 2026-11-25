import * as glob from '@actions/glob'
import * as fs from 'fs'
import * as path from 'path'

export const PROJECT_EXTENSIONS = ['.csproj', '.vbproj', '.fsproj']

/**
 * Splits the `projects` input into glob patterns. Entries may be separated by commas and/or newlines
 * (the documented "glob pattern or comma-separated list"); each entry is trimmed and blank entries and
 * `#` comment lines are dropped. A leading `!` excludes matches, as in @actions/glob.
 */
export function parseProjectPatterns(input: string): string[] {
  return input
    .split(/[,\r\n]+/)
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0 && !entry.startsWith('#'))
}

/**
 * Makes each pattern absolute, resolving relative patterns against the repository root (not the process
 * working directory), and keeps any leading `!` negation.
 */
export function resolvePatterns(patterns: string[], root: string): string[] {
  return patterns.map(pattern => {
    const negation = /^!+/.exec(pattern)?.[0] ?? ''
    const body = pattern.slice(negation.length).trim()
    if (path.isAbsolute(body) || body.startsWith('~')) {
      return negation + body
    }
    return negation + path.join(root, body)
  })
}

/** True when `file` is strictly inside `root`. */
export function isWithin(root: string, file: string): boolean {
  const relative = path.relative(root, file)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export function isProjectFile(file: string): boolean {
  return PROJECT_EXTENSIONS.some(extension => file.endsWith(extension))
}

export function realpathOrSelf(file: string): string {
  try {
    return fs.realpathSync(file)
  } catch {
    return path.resolve(file)
  }
}

export interface ProjectFileSelection {
  /** Absolute paths of the matched project files inside the repository, sorted. */
  files: string[]
  /** Matched project files that were dropped because they are outside the repository. */
  outside: string[]
}

/**
 * Keeps project files (.csproj/.vbproj/.fsproj) that are inside `root` (compared by real path, so a
 * symlink pointing out of the repository is dropped too), removes duplicates and sorts them.
 */
export function selectProjectFiles(files: string[], root: string): ProjectFileSelection {
  const realRoot = realpathOrSelf(root)
  const seen = new Set<string>()
  const selected: string[] = []
  const outside: string[] = []

  for (const file of files) {
    if (!isProjectFile(file)) continue
    const absolute = path.resolve(root, file)
    const real = realpathOrSelf(absolute)
    if (!isWithin(realRoot, real)) {
      outside.push(absolute)
      continue
    }
    if (seen.has(real)) continue
    seen.add(real)
    selected.push(absolute)
  }

  selected.sort()
  return { files: selected, outside }
}

/**
 * Finds the project files selected by the `projects` input, relative to the repository root.
 * Throws when the input has no patterns or nothing inside the repository matches, so a typo fails the
 * step instead of silently producing no (or made-up) versions.
 */
export async function findProjectFiles(projectsInput: string, repositoryPath: string): Promise<ProjectFileSelection> {
  const root = path.resolve(repositoryPath)
  const patterns = parseProjectPatterns(projectsInput)
  if (patterns.length === 0) {
    throw new Error(`The 'projects' input contains no patterns: ${JSON.stringify(projectsInput)}`)
  }

  const globber = await glob.create(resolvePatterns(patterns, root).join('\n'), {
    matchDirectories: false,
    implicitDescendants: true
  })
  const selection = selectProjectFiles(await globber.glob(), root)

  if (selection.files.length === 0) {
    const outsideNote = selection.outside.length > 0
      ? ` (${selection.outside.length} matching project file(s) outside the repository were ignored: ${selection.outside.slice(0, 5).join(', ')})`
      : ''
    throw new Error(
      `No project files (${PROJECT_EXTENSIONS.join(', ')}) matched the 'projects' input ${JSON.stringify(patterns)} ` +
      `under repository-path '${root}'${outsideNote}. Patterns are relative to repository-path and may be separated by commas or newlines.`
    )
  }

  return selection
}
