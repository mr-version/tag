import { ProjectVersion } from './mrversion';
export interface FilterOptions {
    includeTestProjects: boolean;
    includeNonPackable: boolean;
    onlyChanged: boolean;
}
/**
 * Parses the `projects-json` input: the `projects` (or `changed-projects`) output of mr-version/calculate,
 * a JSON array of { project, version, versionChanged, isTestProject, isPackable, ... }.
 */
export declare function parseProjectsJson(input: string): ProjectVersion[];
export declare function filterProjects(projects: ProjectVersion[], options: FilterOptions): ProjectVersion[];
/** Project tag name, e.g. "lib2/v1.1.1-rc.1" (the form mr-version reads back as the project's version). */
export declare function projectTagName(projectName: string, tagPrefix: string, version: string): string;
export declare function formatTagMessage(template: string, version: string, project: string, type: string): string;
export declare function determineGlobalTags(projects: ProjectVersion[], strategy: string, tagPrefix: string): {
    tagName: string;
    version: string;
}[];
/** `git push` arguments that push exactly the given tags (never --tags, which would push every local tag). */
export declare function buildPushArgs(tagNames: string[], remote?: string): string[];
