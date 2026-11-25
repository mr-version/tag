export interface VersionParts {
  major: string
  minor: string
  patch: string
  /** Prerelease label exactly as in the version (e.g. "new-widget.2"), or '' when there is none. */
  prerelease: string
  /** Build metadata after '+', or '' when there is none. */
  buildMetadata: string
}

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+(.*))?$/

/** Splits a semantic version into its parts; returns null when it is not MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]. */
export function parseVersion(version: string): VersionParts | null {
  const match = VERSION_PATTERN.exec(version.trim())
  if (!match) return null
  return {
    major: match[1],
    minor: match[2],
    patch: match[3],
    prerelease: match[4] ?? '',
    buildMetadata: match[5] ?? ''
  }
}

/** The project whose version feeds the single-version outputs: the first changed project, else the first project. */
export function selectPrimaryProject<T>(changedProjects: T[], projects: T[]): T | undefined {
  return changedProjects[0] ?? projects[0]
}
