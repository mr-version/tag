import { afterAll, beforeAll, describe, expect, it } from '@jest/globals'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { findProjectFiles, isWithin, parseProjectPatterns, resolvePatterns, selectProjectFiles } from '../projects'

describe('parseProjectPatterns', () => {
  it('splits a comma-separated list and trims entries', () => {
    expect(parseProjectPatterns('src/Lib1/Lib1.csproj, src/Lib2/Lib2.csproj')).toEqual([
      'src/Lib1/Lib1.csproj',
      'src/Lib2/Lib2.csproj'
    ])
  })

  it('splits on newlines, commas at line ends and CRLF', () => {
    expect(parseProjectPatterns('src/A/A.csproj,\r\n  src/B/B.csproj,\n\nsrc/C/**/*.csproj\n')).toEqual([
      'src/A/A.csproj',
      'src/B/B.csproj',
      'src/C/**/*.csproj'
    ])
  })

  it('keeps a single glob and negations, drops blanks and comments', () => {
    expect(parseProjectPatterns('**/*.csproj')).toEqual(['**/*.csproj'])
    expect(parseProjectPatterns(' , ,\n# comment\n!tests/**')).toEqual(['!tests/**'])
    expect(parseProjectPatterns('')).toEqual([])
  })
})

describe('resolvePatterns', () => {
  const root = path.resolve('/work/repo')

  it('resolves relative patterns against the repository root', () => {
    expect(resolvePatterns(['src/**/*.csproj', './a/A.csproj'], root)).toEqual([
      path.join(root, 'src/**/*.csproj'),
      path.join(root, 'a/A.csproj')
    ])
  })

  it('keeps negation and absolute patterns', () => {
    expect(resolvePatterns(['!tests/**', path.resolve('/abs/X.csproj')], root)).toEqual([
      `!${path.join(root, 'tests/**')}`,
      path.resolve('/abs/X.csproj')
    ])
  })
})

describe('isWithin', () => {
  const root = path.resolve('/work/repo')
  it('accepts files below the root only', () => {
    expect(isWithin(root, path.join(root, 'src/A.csproj'))).toBe(true)
    expect(isWithin(root, root)).toBe(false)
    expect(isWithin(root, path.resolve('/work/other/B.csproj'))).toBe(false)
    expect(isWithin(root, path.resolve('/work/repo-2/B.csproj'))).toBe(false)
    expect(isWithin(root, path.join(root, '..foo', 'C.csproj'))).toBe(true)
  })
})

describe('selectProjectFiles', () => {
  it('keeps project files inside the root, dedupes and sorts', () => {
    const root = path.resolve('/work/repo')
    const selection = selectProjectFiles([
      path.join(root, 'src/B/B.csproj'),
      path.join(root, 'src/A/A.fsproj'),
      path.join(root, 'src/B/B.csproj'),
      path.join(root, 'src/A/readme.md'),
      path.resolve('/work/other/O.csproj')
    ], root)
    expect(selection.files).toEqual([path.join(root, 'src/A/A.fsproj'), path.join(root, 'src/B/B.csproj')])
    expect(selection.outside).toEqual([path.resolve('/work/other/O.csproj')])
  })
})

describe('findProjectFiles', () => {
  let workspace: string
  let repo: string

  beforeAll(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'calc-projects-'))
    repo = path.join(workspace, 'repo')
    for (const file of ['repo/src/Lib1/Lib1.csproj', 'repo/src/Lib2/Lib2.csproj', 'repo/tests/T/T.csproj', 'other/Other/Other.csproj']) {
      fs.mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true })
      fs.writeFileSync(path.join(workspace, file), '<Project />')
    }
  })

  afterAll(() => fs.rmSync(workspace, { recursive: true, force: true }))

  it('matches a comma-separated list relative to repository-path, not the working directory', async () => {
    const selection = await findProjectFiles('src/Lib1/Lib1.csproj, src/Lib2/Lib2.csproj', repo)
    expect(selection.files.map(f => path.relative(repo, f))).toEqual([
      path.join('src', 'Lib1', 'Lib1.csproj'),
      path.join('src', 'Lib2', 'Lib2.csproj')
    ])
  })

  it('does not pick up projects of other checkouts in the workspace', async () => {
    const selection = await findProjectFiles('**/*.csproj', repo)
    expect(selection.files).toHaveLength(3)
    expect(selection.files.every(f => f.startsWith(repo + path.sep))).toBe(true)
  })

  it('drops explicit paths outside the repository', async () => {
    const selection = await findProjectFiles('src/Lib1/Lib1.csproj,../other/Other/Other.csproj', repo)
    expect(selection.files).toEqual([path.join(repo, 'src', 'Lib1', 'Lib1.csproj')])
    expect(selection.outside).toEqual([path.join(workspace, 'other', 'Other', 'Other.csproj')])
  })

  it('supports exclusions', async () => {
    const selection = await findProjectFiles('**/*.csproj\n!tests/**', repo)
    expect(selection.files).toHaveLength(2)
  })

  it('fails when nothing matches', async () => {
    await expect(findProjectFiles('src/Nope/*.csproj', repo)).rejects.toThrow(/No project files/)
    await expect(findProjectFiles(' , ', repo)).rejects.toThrow(/no patterns/)
  })
})
