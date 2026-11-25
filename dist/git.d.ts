export interface HistoryInfo {
    /** Top-level directory of the git repository that contains repository-path. */
    gitRoot: string;
    shallow: boolean;
    /** Number of version tags (tag-prefix followed by a digit, optionally after "project/") reachable from HEAD. */
    reachableVersionTags: number;
    /** Number of tags in the repository. */
    totalTags: number;
}
export interface HistoryVerdict {
    level: 'ok' | 'notice' | 'warning' | 'error';
    message?: string;
}
/** Counts tags that look like version tags: "<prefix><digit>..." or "<project>/<prefix><digit>...". */
export declare function countVersionTags(tags: string[], tagPrefix: string): number;
/**
 * Decides whether the clone has enough history to calculate versions. A shallow clone (actions/checkout's
 * default fetch-depth: 1) hides the tags and commits mr-version needs, which silently turns every project
 * into 0.1.0, so it is an error unless allowShallow is set.
 */
export declare function evaluateHistory(info: HistoryInfo, allowShallow: boolean): HistoryVerdict;
export declare function inspectHistory(repositoryRoot: string, tagPrefix: string): Promise<HistoryInfo>;
