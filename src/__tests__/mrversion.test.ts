import { describe, expect, it } from '@jest/globals'
import * as path from 'path'
import {
  ReportOutput,
  buildReportArgs,
  buildVersionArgs,
  formatCliFailure,
  mapLimit,
  matchReportProjects,
  parseCliJson,
  parseReportOutput,
  reportBlockers
} from '../mrversion'

const root = path.resolve('/work/repo')

const options = {
  repositoryRoot: root,
  prereleaseType: 'none',
  tagPrefix: 'v',
  forceVersion: '',
  configFile: ''
}

describe('buildVersionArgs', () => {
  it('never passes --dependencies or --dry-run', () => {
    const args = buildVersionArgs(options, path.join(root, 'src/A/A.csproj'))
    expect(args).toEqual(['version', '--repo', root, '--project', path.join(root, 'src/A/A.csproj'), '--json', '--tag-prefix', 'v'])
    expect(args).not.toContain('--dependencies')
    expect(args).not.toContain('--dry-run')
  })

  it('passes prerelease-type, force-version and config-file when set', () => {
    const args = buildVersionArgs({ ...options, prereleaseType: 'rc', forceVersion: '2.0.0', configFile: 'mr-version.yml' }, 'A.csproj')
    expect(args).toEqual([
      'version', '--repo', root, '--project', 'A.csproj', '--json',
      '--prerelease-type', 'rc', '--tag-prefix', 'v', '--force-version', '2.0.0', '--config-file', 'mr-version.yml'
    ])
  })
})

describe('buildReportArgs', () => {
  it('asks for JSON covering every project', () => {
    expect(buildReportArgs(options)).toEqual([
      'report', '--repo', root, '--output', 'json', '--include-test-projects', '--include-non-packable', '--tag-prefix', 'v'
    ])
  })
})

describe('reportBlockers', () => {
  it('allows report for the plain case', () => {
    expect(reportBlockers(options)).toEqual([])
    expect(reportBlockers({ ...options, prereleaseType: 'None' })).toEqual([])
  })

  it('blocks report for options it cannot reproduce', () => {
    expect(reportBlockers({ ...options, prereleaseType: 'rc' })).toEqual(["prerelease-type 'rc'"])
    expect(reportBlockers({ ...options, forceVersion: '1.0.0' })).toEqual(['force-version'])
    expect(reportBlockers({ ...options, configFile: 'cfg.yml' })).toEqual(["config-file 'cfg.yml'"])
    expect(reportBlockers(options, path.join(root, 'mr-version.yml'))).toEqual(["configuration file 'mr-version.yml'"])
  })
})

describe('formatCliFailure', () => {
  it('includes stdout, where the CLI prints usage errors, and stderr', () => {
    const message = formatCliFailure('mr-version failed for A.csproj', ['version', '--dependencies', 'x'], {
      exitCode: 1,
      stdout: "ERROR(S):\n  Option 'dependencies' is unknown.\n",
      stderr: 'boom'
    })
    expect(message).toContain("exited with code 1")
    expect(message).toContain("Option 'dependencies' is unknown.")
    expect(message).toContain('stderr:\nboom')
  })

  it('says so when there is no output', () => {
    expect(formatCliFailure('x', [], { exitCode: 2, stdout: '', stderr: ' ' })).toContain('(no output)')
  })
})

describe('parseCliJson', () => {
  it('tolerates log lines before the JSON document', () => {
    expect(parseCliJson<{ a: number }>('[Info] hello\n{"a": 1}')).toEqual({ a: 1 })
  })

  it('fails on empty output', () => {
    expect(() => parseCliJson('  ')).toThrow(/empty output/)
  })
})

const report: ReportOutput = {
  repository: root,
  projects: [
    {
      name: 'App',
      path: 'src/App/App.csproj',
      fullPath: path.join(root, 'src/App/App.csproj'),
      version: {
        version: '1.1.1',
        previousVersion: '1.1.0-preview.1',
        versionChanged: true,
        changeReason: 'Main branch: Incrementing patch version',
        commitSha: 'fdf27c4',
        branchType: 'Main',
        branchName: 'main',
        commitHeight: null
      },
      dependencies: { direct: [{ name: 'Lib1' }], all: [{ name: 'Lib1', isTransitive: false }, { name: 'Core', isTransitive: true }] },
      isTestProject: false,
      isPackable: true
    },
    {
      name: 'Core',
      path: 'src/Core/Core.csproj',
      fullPath: path.join(root, 'src/Core/Core.csproj'),
      version: { version: '1.1.0-preview.1', versionChanged: false, changeReason: 'No changes detected' },
      dependencies: { direct: [], all: [] },
      isTestProject: false,
      isPackable: true
    },
    {
      name: 'Lib1',
      path: 'src/Lib1/Lib1.csproj',
      version: { version: '1.0.2', versionChanged: false },
      dependencies: { direct: [{ name: 'Core' }], all: [{ name: 'Core', isTransitive: false }] },
      isTestProject: false,
      isPackable: true
    },
    {
      name: 'Core.Tests',
      path: 'tests/Core.Tests/Core.Tests.csproj',
      fullPath: path.join(root, 'tests/Core.Tests/Core.Tests.csproj'),
      version: { version: '1.0.0', versionChanged: false, changeReason: 'Test project - using base global version' },
      dependencies: null,
      isTestProject: true,
      isPackable: false
    }
  ]
}

describe('parseReportOutput', () => {
  it('requires a projects array', () => {
    expect(() => parseReportOutput('{"repository": "x"}')).toThrow(/projects/)
    expect(parseReportOutput(JSON.stringify(report)).projects).toHaveLength(4)
  })
})

describe('matchReportProjects', () => {
  it('maps report entries to the version --json shape for the requested files only, in order', () => {
    const files = [path.join(root, 'tests/Core.Tests/Core.Tests.csproj'), path.join(root, 'src/App/App.csproj'), path.join(root, 'src/Lib1/Lib1.csproj')]
    const [tests, app, lib1] = matchReportProjects(report, files, root)

    expect(app).toEqual({
      project: 'App',
      path: files[1],
      version: '1.1.1',
      previousVersion: '1.1.0-preview.1',
      versionChanged: true,
      changeReason: 'Main branch: Incrementing patch version',
      commitSha: 'fdf27c4',
      commitDate: null,
      commitMessage: null,
      branchType: 'Main',
      branchName: 'main',
      commitHeight: null,
      isTestProject: false,
      isPackable: true,
      dependencies: [path.join(root, 'src/Lib1/Lib1.csproj'), path.join(root, 'src/Core/Core.csproj')],
      validation: null
    })
    expect(tests).toMatchObject({ project: 'Core.Tests', version: '1.0.0', isTestProject: true, isPackable: false, dependencies: [] })
    // entries without fullPath are resolved from path relative to the repository
    expect(lib1).toMatchObject({ project: 'Lib1', version: '1.0.2', path: files[2] })
  })

  it('returns undefined for files the report does not cover', () => {
    expect(matchReportProjects(report, [path.join(root, 'src/Missing/Missing.csproj')], root)).toEqual([undefined])
  })
})

describe('mapLimit', () => {
  it('keeps order and bounds concurrency', async () => {
    let running = 0
    let peak = 0
    const result = await mapLimit([5, 1, 4, 2, 3], 2, async n => {
      running++
      peak = Math.max(peak, running)
      await new Promise(resolve => setTimeout(resolve, n * 5))
      running--
      return n * 10
    })
    expect(result).toEqual([50, 10, 40, 20, 30])
    expect(peak).toBe(2)
  })

  it('handles empty input', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([])
  })
})
