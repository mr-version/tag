import { ProjectVersion } from './mrversion'
import { parseVersion } from './version'

export interface FilterOptions {
  includeTestProjects: boolean
  includeNonPackable: boolean
  onlyChanged: boolean
}

/**
 * Parses the `projects-json` input: the `projects` (or `changed-projects`) output of mr-version/calculate,
 * a JSON array of { project, version, versionChanged, isTestProject, isPackable, ... }.
 */
export function parseProjectsJson(input: string): ProjectVersion[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch (error) {
    throw new Error(`The 'projects-json' input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!Array.isArray(parsed)) {
    throw new Error("The 'projects-json' input must be a JSON array (the 'projects' output of mr-version/calculate)")
  }

  return parsed.map((entry, index) => {
    const item = entry as Partial<ProjectVersion> | null
    if (!item || typeof item !== 'object' || typeof item.project !== 'string' || !item.project ||
        typeof item.version !== 'string' || !item.version) {
      throw new Error(`'projects-json' entry ${index} needs non-empty string 'project' and 'version' fields: ${JSON.stringify(entry)}`)
    }
    return {
      ...item,
      project: item.project,
      path: typeof item.path === 'string' ? item.path : '',
      version: item.version,
      versionChanged: item.versionChanged === true,
      isTestProject: item.isTestProject === true,
      isPackable: item.isPackable !== false,
      dependencies: Array.isArray(item.dependencies) ? item.dependencies : []
    }
  })
}

export function filterProjects(projects: ProjectVersion[], options: FilterOptions): ProjectVersion[] {
  return projects.filter(project => {
    if (!options.includeTestProjects && project.isTestProject) return false
    if (!options.includeNonPackable && !project.isPackable) return false
    if (options.onlyChanged && !project.versionChanged) return false
    return true
  })
}

/** Project tag name, e.g. "lib2/v1.1.1-rc.1" (the form mr-version reads back as the project's version). */
export function projectTagName(projectName: string, tagPrefix: string, version: string): string {
  return `${projectName.toLowerCase()}/${tagPrefix}${version}`
}

export function formatTagMessage(template: string, version: string, project: string, type: string): string {
  return template.split('{version}').join(version).split('{project}').join(project).split('{type}').join(type)
}

export function determineGlobalTags(projects: ProjectVersion[], strategy: string, tagPrefix: string): { tagName: string; version: string }[] {
  const globalTags: { tagName: string; version: string }[] = []

  for (const project of projects) {
    const parts = parseVersion(project.version)
    if (!parts) continue

    let shouldCreateGlobalTag = false
    switch (strategy.toLowerCase()) {
      case 'major-only':
        shouldCreateGlobalTag = parts.minor === '0' && parts.patch === '0'
        break
      case 'all':
        shouldCreateGlobalTag = true
        break
      case 'none':
        shouldCreateGlobalTag = false
        break
    }

    const tagName = `${tagPrefix}${project.version}`
    if (shouldCreateGlobalTag && !globalTags.some(tag => tag.tagName === tagName)) {
      globalTags.push({ tagName, version: project.version })
    }
  }

  return globalTags
}

/** `git push` arguments that push exactly the given tags (never --tags, which would push every local tag). */
export function buildPushArgs(tagNames: string[], remote = 'origin'): string[] {
  return ['push', remote, ...tagNames.map(name => `refs/tags/${name}`)]
}
