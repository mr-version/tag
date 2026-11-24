import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { realpathOrSelf } from './projects'

export interface ValidationError {
  message: string
  details?: string
  constraintName?: string
  expected?: string
  actual?: string
}

export interface ValidationWarning {
  message: string
  details?: string
  ruleName?: string
}

export interface ValidationResult {
  isValid: boolean
  summary: string
  errors?: ValidationError[]
  warnings?: ValidationWarning[]
}

/** One project's calculated version, in the shape of `mr-version version --json` (the action's `projects` output). */
export interface ProjectVersion {
  project: string
  path: string
  version: string
  previousVersion?: string | null
  versionChanged: boolean
  changeReason?: string | null
  commitSha?: string | null
  commitDate?: string | null
  commitMessage?: string | null
  branchType?: string | null
  branchName?: string | null
  commitHeight?: number | null
  isTestProject: boolean
  isPackable: boolean
  dependencies: string[]
  validation?: ValidationResult | null
}

/** A project entry of `mr-version report --output json`. */
export interface ReportProject {
  name: string
  path?: string
  fullPath?: string
  version?: {
    version?: string | null
    previousVersion?: string | null
    versionChanged?: boolean
    changeReason?: string | null
    commitSha?: string | null
    commitDate?: string | null
    commitMessage?: string | null
    branchType?: string | null
    branchName?: string | null
    commitHeight?: number | null
  } | null
  dependencies?: {
    direct?: Array<{ name: string }>
    all?: Array<{ name: string; isTransitive?: boolean }>
  } | null
  isTestProject?: boolean
  isPackable?: boolean
}

export interface ReportOutput {
  repository?: string
  projects: ReportProject[]
}

export interface CalculationOptions {
  /** Absolute repository-path. */
  repositoryRoot: string
  /** Top-level directory of the git repository (where mr-version looks for mr-version.yml). */
  gitRoot: string
  /** Absolute project file paths to calculate versions for. */
  projectFiles: string[]
  prereleaseType: string
  tagPrefix: string
  forceVersion: string
  configFile: string
}

export interface CalculationResult {
  projects: ProjectVersion[]
  /** How the versions were calculated: one `report` call, per-project `version` calls, or both. */
  mode: 'report' | 'per-project' | 'report+per-project'
  /** Why the single `report` call was not (fully) used. */
  reason?: string
}

/** Config files mr-version auto-discovers in the repository root (ConfigurationService.DefaultConfigFiles). */
export const DEFAULT_CONFIG_FILES = ['mr-version.yml', 'mr-version.yaml', 'mister-version.yml', 'mister-version.yaml']

export function findDefaultConfig(gitRoot: string): string | undefined {
  return DEFAULT_CONFIG_FILES.map(name => path.join(gitRoot, name)).find(file => fs.existsSync(file))
}

/**
 * Reasons the single `mr-version report` call cannot reproduce `mr-version version`: report has no
 * --prerelease-type/--force-version options, and it applies only part of mr-version.yml (no commit
 * conventions, change detection, CalVer, constraints, ...), so any configuration file forces the
 * per-project path. Returns [] when report gives the same versions.
 */
export function reportBlockers(options: Pick<CalculationOptions, 'prereleaseType' | 'forceVersion' | 'configFile'>, defaultConfig?: string): string[] {
  const blockers: string[] = []
  if (options.prereleaseType && options.prereleaseType.toLowerCase() !== 'none') {
    blockers.push(`prerelease-type '${options.prereleaseType}'`)
  }
  if (options.forceVersion) blockers.push('force-version')
  if (options.configFile) blockers.push(`config-file '${options.configFile}'`)
  else if (defaultConfig) blockers.push(`configuration file '${path.basename(defaultConfig)}'`)
  return blockers
}

export function buildReportArgs(options: Pick<CalculationOptions, 'repositoryRoot' | 'tagPrefix'>): string[] {
  return [
    'report',
    '--repo', options.repositoryRoot,
    '--output', 'json',
    '--include-test-projects',
    '--include-non-packable',
    '--tag-prefix', options.tagPrefix
  ]
}

export function buildVersionArgs(options: Omit<CalculationOptions, 'projectFiles' | 'gitRoot'>, projectFile: string): string[] {
  const args = ['version', '--repo', options.repositoryRoot, '--project', projectFile, '--json']
  if (options.prereleaseType && options.prereleaseType.toLowerCase() !== 'none') {
    args.push('--prerelease-type', options.prereleaseType)
  }
  if (options.tagPrefix) args.push('--tag-prefix', options.tagPrefix)
  if (options.forceVersion) args.push('--force-version', options.forceVersion)
  if (options.configFile) args.push('--config-file', options.configFile)
  return args
}

function truncate(text: string, max = 4000): string {
  return text.length > max ? `${text.slice(0, max)}\n... (${text.length - max} more characters)` : text
}

/** Error text for a failed mr-version call; includes stdout too, because the CLI prints usage errors there. */
export function formatCliFailure(what: string, args: string[], output: { exitCode: number; stdout: string; stderr: string }): string {
  const lines = [`${what}: 'mr-version ${args.join(' ')}' exited with code ${output.exitCode}`]
  const stderr = output.stderr.trim()
  const stdout = output.stdout.trim()
  if (stderr) lines.push(`stderr:\n${truncate(stderr)}`)
  if (stdout) lines.push(`stdout:\n${truncate(stdout)}`)
  if (!stderr && !stdout) lines.push('(no output)')
  return lines.join('\n')
}

async function runMrVersion(args: string[]): Promise<exec.ExecOutput> {
  try {
    return await exec.getExecOutput('mr-version', args, { silent: true, ignoreReturnCode: true })
  } catch (error) {
    throw new Error(
      `Could not run mr-version (${error instanceof Error ? error.message : String(error)}). ` +
      `Install it first, e.g. with the mr-version/setup action.`
    )
  }
}

/** Parses the JSON object printed by the CLI, tolerating log lines before it. */
export function parseCliJson<T>(stdout: string): T {
  const text = stdout.trim()
  if (!text) throw new Error('mr-version returned empty output')
  try {
    return JSON.parse(text) as T
  } catch (error) {
    const start = text.search(/^\{/m)
    if (start > 0) return JSON.parse(text.slice(start)) as T
    throw error
  }
}

export function parseReportOutput(stdout: string): ReportOutput {
  const report = parseCliJson<ReportOutput>(stdout)
  if (!report || !Array.isArray(report.projects)) {
    throw new Error("mr-version report output has no 'projects' array")
  }
  return report
}

function reportProjectFullPath(project: ReportProject, reportRoot: string): string | undefined {
  if (project.fullPath) return project.fullPath
  if (project.path) return path.resolve(reportRoot, project.path)
  return undefined
}

export function mapReportProject(project: ReportProject, projectFile: string, pathByName: Map<string, string>): ProjectVersion {
  const version = project.version ?? {}
  return {
    project: project.name,
    path: projectFile,
    version: version.version ?? '',
    previousVersion: version.previousVersion ?? null,
    versionChanged: version.versionChanged === true,
    changeReason: version.changeReason ?? null,
    commitSha: version.commitSha ?? null,
    commitDate: version.commitDate ?? null,
    commitMessage: version.commitMessage ?? null,
    branchType: version.branchType ?? null,
    branchName: version.branchName ?? null,
    commitHeight: version.commitHeight ?? null,
    isTestProject: project.isTestProject === true,
    isPackable: project.isPackable !== false,
    // `version --json` lists the transitive dependencies as project file paths
    dependencies: (project.dependencies?.all ?? []).map(dep => pathByName.get(dep.name) ?? dep.name),
    validation: null
  }
}

/**
 * Maps report projects onto the requested project files (matched by real path). Returns the mapped
 * versions in projectFiles order (undefined where the report has no usable entry).
 */
export function matchReportProjects(report: ReportOutput, projectFiles: string[], reportRoot: string): Array<ProjectVersion | undefined> {
  const byPath = new Map<string, ReportProject>()
  const pathByName = new Map<string, string>()
  for (const project of report.projects) {
    const fullPath = reportProjectFullPath(project, report.repository ?? reportRoot)
    if (!fullPath || !project.name) continue
    byPath.set(realpathOrSelf(fullPath), project)
    if (!pathByName.has(project.name)) pathByName.set(project.name, fullPath)
  }

  return projectFiles.map(file => {
    const project = byPath.get(realpathOrSelf(file))
    if (!project || !project.version?.version) return undefined
    return mapReportProject(project, file, pathByName)
  })
}

async function calculateViaReport(options: CalculationOptions): Promise<Array<ProjectVersion | undefined>> {
  const args = buildReportArgs(options)
  const output = await runMrVersion(args)
  if (output.exitCode !== 0) {
    throw new Error(formatCliFailure('mr-version report failed', args, output))
  }
  core.debug(`mr-version report stderr:\n${output.stderr}`)
  let report: ReportOutput
  try {
    report = parseReportOutput(output.stdout)
  } catch (error) {
    throw new Error(`Failed to parse 'mr-version report' output: ${error instanceof Error ? error.message : String(error)}`)
  }
  return matchReportProjects(report, options.projectFiles, options.gitRoot)
}

export async function calculateProjectVersion(options: CalculationOptions, projectFile: string): Promise<ProjectVersion> {
  const args = buildVersionArgs(options, projectFile)
  const output = await runMrVersion(args)
  if (output.exitCode !== 0) {
    throw new Error(formatCliFailure(`mr-version failed for ${projectFile}`, args, output))
  }
  let result: ProjectVersion
  try {
    result = parseCliJson<ProjectVersion>(output.stdout)
  } catch (error) {
    throw new Error(
      `Failed to parse mr-version output for ${projectFile}: ${error instanceof Error ? error.message : String(error)}\n` +
      `stdout:\n${truncate(output.stdout.trim())}\nstderr:\n${truncate(output.stderr.trim())}`
    )
  }
  return { ...result, path: projectFile }
}

/** Runs fn over items with at most `limit` in flight, keeping the input order in the result. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

function parallelism(): number {
  const cpus = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length
  return Math.max(1, Math.min(4, cpus))
}

/**
 * Calculates the versions of options.projectFiles. Uses one `mr-version report` call (which analyses every
 * project in a single process) when that yields the same versions as `mr-version version`; otherwise, or for
 * projects the report does not cover, or if report fails, runs `mr-version version --json` per project.
 */
export async function calculateVersions(options: CalculationOptions): Promise<CalculationResult> {
  const blockers = reportBlockers(options, options.configFile ? undefined : findDefaultConfig(options.gitRoot))
  let fromReport: Array<ProjectVersion | undefined> | undefined
  let reason: string | undefined

  if (blockers.length === 0) {
    try {
      fromReport = await calculateViaReport(options)
    } catch (error) {
      reason = `mr-version report failed`
      core.warning(
        `Falling back to one 'mr-version version' call per project: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  } else {
    reason = `${blockers.join(', ')} ${blockers.length === 1 ? 'is' : 'are'} not supported by 'mr-version report'`
    core.info(`Calculating versions with one 'mr-version version' call per project: ${reason}`)
  }

  const missing = options.projectFiles.filter((_, index) => !fromReport?.[index])
  if (fromReport && missing.length > 0) {
    core.info(`mr-version report did not cover ${missing.length} project(s); calculating them individually: ${missing.join(', ')}`)
  }
  const individual = await mapLimit(missing, parallelism(), file => calculateProjectVersion(options, file))
  const individualByFile = new Map(missing.map((file, index) => [file, individual[index]]))

  const projects = options.projectFiles.map((file, index) => fromReport?.[index] ?? (individualByFile.get(file) as ProjectVersion))
  const mode = !fromReport ? 'per-project' : missing.length > 0 ? 'report+per-project' : 'report'
  if (mode === 'report+per-project') reason = `mr-version report did not cover ${missing.length} project(s)`
  return { projects, mode, reason }
}
