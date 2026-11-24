export declare const PROJECT_EXTENSIONS: string[];
/**
 * Splits the `projects` input into glob patterns. Entries may be separated by commas and/or newlines
 * (the documented "glob pattern or comma-separated list"); each entry is trimmed and blank entries and
 * `#` comment lines are dropped. A leading `!` excludes matches, as in @actions/glob.
 */
export declare function parseProjectPatterns(input: string): string[];
/**
 * Makes each pattern absolute, resolving relative patterns against the repository root (not the process
 * working directory), and keeps any leading `!` negation.
 */
export declare function resolvePatterns(patterns: string[], root: string): string[];
/** True when `file` is strictly inside `root`. */
export declare function isWithin(root: string, file: string): boolean;
export declare function isProjectFile(file: string): boolean;
export declare function realpathOrSelf(file: string): string;
export interface ProjectFileSelection {
    /** Absolute paths of the matched project files inside the repository, sorted. */
    files: string[];
    /** Matched project files that were dropped because they are outside the repository. */
    outside: string[];
}
/**
 * Keeps project files (.csproj/.vbproj/.fsproj) that are inside `root` (compared by real path, so a
 * symlink pointing out of the repository is dropped too), removes duplicates and sorts them.
 */
export declare function selectProjectFiles(files: string[], root: string): ProjectFileSelection;
/**
 * Finds the project files selected by the `projects` input, relative to the repository root.
 * Throws when the input has no patterns or nothing inside the repository matches, so a typo fails the
 * step instead of silently producing no (or made-up) versions.
 */
export declare function findProjectFiles(projectsInput: string, repositoryPath: string): Promise<ProjectFileSelection>;
