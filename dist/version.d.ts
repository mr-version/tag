export interface VersionParts {
    major: string;
    minor: string;
    patch: string;
    /** Prerelease label exactly as in the version (e.g. "new-widget.2"), or '' when there is none. */
    prerelease: string;
    /** Build metadata after '+', or '' when there is none. */
    buildMetadata: string;
}
/** Splits a semantic version into its parts; returns null when it is not MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]. */
export declare function parseVersion(version: string): VersionParts | null;
/** The project whose version feeds the single-version outputs: the first changed project, else the first project. */
export declare function selectPrimaryProject<T>(changedProjects: T[], projects: T[]): T | undefined;
