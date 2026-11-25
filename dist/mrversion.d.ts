export interface ValidationError {
    message: string;
    details?: string;
    constraintName?: string;
    expected?: string;
    actual?: string;
}
export interface ValidationWarning {
    message: string;
    details?: string;
    ruleName?: string;
}
export interface ValidationResult {
    isValid: boolean;
    summary: string;
    errors?: ValidationError[];
    warnings?: ValidationWarning[];
}
/** One project's calculated version, in the shape of `mr-version version --json` (the action's `projects` output). */
export interface ProjectVersion {
    project: string;
    path: string;
    version: string;
    previousVersion?: string | null;
    versionChanged: boolean;
    changeReason?: string | null;
    commitSha?: string | null;
    commitDate?: string | null;
    commitMessage?: string | null;
    branchType?: string | null;
    branchName?: string | null;
    commitHeight?: number | null;
    isTestProject: boolean;
    isPackable: boolean;
    dependencies: string[];
    validation?: ValidationResult | null;
}
/** A project entry of `mr-version report --output json`. */
export interface ReportProject {
    name: string;
    path?: string;
    fullPath?: string;
    version?: {
        version?: string | null;
        previousVersion?: string | null;
        versionChanged?: boolean;
        changeReason?: string | null;
        commitSha?: string | null;
        commitDate?: string | null;
        commitMessage?: string | null;
        branchType?: string | null;
        branchName?: string | null;
        commitHeight?: number | null;
    } | null;
    dependencies?: {
        direct?: Array<{
            name: string;
        }>;
        all?: Array<{
            name: string;
            isTransitive?: boolean;
        }>;
    } | null;
    isTestProject?: boolean;
    isPackable?: boolean;
}
export interface ReportOutput {
    repository?: string;
    projects: ReportProject[];
}
export interface CalculationOptions {
    /** Absolute repository-path. */
    repositoryRoot: string;
    /** Top-level directory of the git repository (where mr-version looks for mr-version.yml). */
    gitRoot: string;
    /** Absolute project file paths to calculate versions for. */
    projectFiles: string[];
    prereleaseType: string;
    tagPrefix: string;
    forceVersion: string;
    configFile: string;
}
export interface CalculationResult {
    projects: ProjectVersion[];
    /** How the versions were calculated: one `report` call, per-project `version` calls, or both. */
    mode: 'report' | 'per-project' | 'report+per-project';
    /** Why the single `report` call was not (fully) used. */
    reason?: string;
}
/** Config files mr-version auto-discovers in the repository root (ConfigurationService.DefaultConfigFiles). */
export declare const DEFAULT_CONFIG_FILES: string[];
export declare function findDefaultConfig(gitRoot: string): string | undefined;
/**
 * Reasons the single `mr-version report` call cannot reproduce `mr-version version`: report has no
 * --prerelease-type/--force-version options, and it applies only part of mr-version.yml (no commit
 * conventions, change detection, CalVer, constraints, ...), so any configuration file forces the
 * per-project path. Returns [] when report gives the same versions.
 */
export declare function reportBlockers(options: Pick<CalculationOptions, 'prereleaseType' | 'forceVersion' | 'configFile'>, defaultConfig?: string): string[];
export declare function buildReportArgs(options: Pick<CalculationOptions, 'repositoryRoot' | 'tagPrefix'>): string[];
export declare function buildVersionArgs(options: Omit<CalculationOptions, 'projectFiles' | 'gitRoot'>, projectFile: string): string[];
/** Error text for a failed mr-version call; includes stdout too, because the CLI prints usage errors there. */
export declare function formatCliFailure(what: string, args: string[], output: {
    exitCode: number;
    stdout: string;
    stderr: string;
}): string;
/** Parses the JSON object printed by the CLI, tolerating log lines before it. */
export declare function parseCliJson<T>(stdout: string): T;
export declare function parseReportOutput(stdout: string): ReportOutput;
export declare function mapReportProject(project: ReportProject, projectFile: string, pathByName: Map<string, string>): ProjectVersion;
/**
 * Maps report projects onto the requested project files (matched by real path). Returns the mapped
 * versions in projectFiles order (undefined where the report has no usable entry).
 */
export declare function matchReportProjects(report: ReportOutput, projectFiles: string[], reportRoot: string): Array<ProjectVersion | undefined>;
export declare function calculateProjectVersion(options: CalculationOptions, projectFile: string): Promise<ProjectVersion>;
/** Runs fn over items with at most `limit` in flight, keeping the input order in the result. */
export declare function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]>;
/**
 * Calculates the versions of options.projectFiles. Uses one `mr-version report` call (which analyses every
 * project in a single process) when that yields the same versions as `mr-version version`; otherwise, or for
 * projects the report does not cover, or if report fails, runs `mr-version version --json` per project.
 */
export declare function calculateVersions(options: CalculationOptions): Promise<CalculationResult>;
