import { describe, expect, it } from '@jest/globals'
import {
  buildPushArgs,
  determineGlobalTags,
  filterProjects,
  formatTagMessage,
  parseProjectsJson,
  projectTagName
} from '../tagging'

const calculateOutput = JSON.stringify([
  { project: 'Core', path: '/w/src/Core/Core.csproj', version: '1.1.0-preview.1', versionChanged: false, isTestProject: false, isPackable: true, dependencies: [] },
  { project: 'Lib2', path: '/w/src/Lib2/Lib2.csproj', version: '1.1.1-rc.1', versionChanged: true, isTestProject: false, isPackable: true, dependencies: [] },
  { project: 'Core.Tests', path: '/w/tests/Core.Tests.csproj', version: '1.0.0', versionChanged: true, isTestProject: true, isPackable: false, dependencies: [] }
])

describe('parseProjectsJson', () => {
  it('reads the projects output of calculate verbatim', () => {
    const projects = parseProjectsJson(calculateOutput)
    expect(projects.map(p => [p.project, p.version, p.versionChanged])).toEqual([
      ['Core', '1.1.0-preview.1', false],
      ['Lib2', '1.1.1-rc.1', true],
      ['Core.Tests', '1.0.0', true]
    ])
  })

  it('defaults missing flags', () => {
    expect(parseProjectsJson('[{"project":"A","version":"1.0.0"}]')[0]).toMatchObject({
      versionChanged: false, isTestProject: false, isPackable: true, dependencies: []
    })
  })

  it('rejects invalid input with a clear message', () => {
    expect(() => parseProjectsJson('not json')).toThrow(/not valid JSON/)
    expect(() => parseProjectsJson('{"projects": []}')).toThrow(/JSON array/)
    expect(() => parseProjectsJson('[{"project":"A"}]')).toThrow(/entry 0/)
  })
})

describe('filterProjects', () => {
  const projects = parseProjectsJson(calculateOutput)

  it('keeps changed, packable, non-test projects by default', () => {
    expect(filterProjects(projects, { includeTestProjects: false, includeNonPackable: false, onlyChanged: true }).map(p => p.project))
      .toEqual(['Lib2'])
  })

  it('honours the include flags', () => {
    expect(filterProjects(projects, { includeTestProjects: true, includeNonPackable: true, onlyChanged: false })).toHaveLength(3)
  })
})

describe('tag names and messages', () => {
  it('uses the calculated prerelease version in the project tag', () => {
    expect(projectTagName('Lib2', 'v', '1.1.1-rc.1')).toBe('lib2/v1.1.1-rc.1')
  })

  it('replaces every placeholder occurrence', () => {
    expect(formatTagMessage('Release {project} {version} ({project})', '1.0.0', 'Lib2', 'Lib2')).toBe('Release Lib2 1.0.0 (Lib2)')
  })
})

describe('determineGlobalTags', () => {
  const projects = parseProjectsJson(JSON.stringify([
    { project: 'A', version: '2.0.0' },
    { project: 'B', version: '2.0.0' },
    { project: 'C', version: '1.4.2-rc.1' }
  ]))

  it('creates major-only tags once', () => {
    expect(determineGlobalTags(projects, 'major-only', 'v')).toEqual([{ tagName: 'v2.0.0', version: '2.0.0' }])
  })

  it('creates all / none', () => {
    expect(determineGlobalTags(projects, 'all', 'v').map(t => t.tagName)).toEqual(['v2.0.0', 'v1.4.2-rc.1'])
    expect(determineGlobalTags(projects, 'none', 'v')).toEqual([])
  })
})

describe('buildPushArgs', () => {
  it('pushes exactly the given tags, never --tags', () => {
    const args = buildPushArgs(['lib2/v1.1.1-rc.1', 'v2.0.0'])
    expect(args).toEqual(['push', 'origin', 'refs/tags/lib2/v1.1.1-rc.1', 'refs/tags/v2.0.0'])
    expect(args).not.toContain('--tags')
  })
})
