import { describe, expect, it } from '@jest/globals'
import { parseVersion, selectPrimaryProject } from '../version'

describe('parseVersion', () => {
  it('parses release versions', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: '1', minor: '2', patch: '3', prerelease: '', buildMetadata: '' })
  })

  it('keeps the prerelease label verbatim, including hyphens', () => {
    expect(parseVersion('1.1.1-new-widget.2')?.prerelease).toBe('new-widget.2')
    expect(parseVersion('2.0.0-rc.1')?.prerelease).toBe('rc.1')
    expect(parseVersion('0.1.0-alpha')?.prerelease).toBe('alpha')
  })

  it('separates build metadata', () => {
    expect(parseVersion('1.0.0-beta.3+feature.abc123')).toEqual({
      major: '1', minor: '0', patch: '0', prerelease: 'beta.3', buildMetadata: 'feature.abc123'
    })
    expect(parseVersion('1.0.0+sha.5114f85')).toEqual({
      major: '1', minor: '0', patch: '0', prerelease: '', buildMetadata: 'sha.5114f85'
    })
  })

  it('handles CalVer-shaped versions', () => {
    expect(parseVersion('2025.11.3')).toMatchObject({ major: '2025', minor: '11', patch: '3' })
  })

  it('rejects non-semver strings', () => {
    expect(parseVersion('1.2')).toBeNull()
    expect(parseVersion('v1.2.3')).toBeNull()
    expect(parseVersion('')).toBeNull()
  })
})

describe('selectPrimaryProject', () => {
  const core = { project: 'Core', versionChanged: false }
  const lib2 = { project: 'Lib2', versionChanged: true }

  it('prefers the first changed project over the alphabetically first project', () => {
    expect(selectPrimaryProject([lib2], [core, lib2])).toBe(lib2)
  })

  it('falls back to the first project when nothing changed', () => {
    expect(selectPrimaryProject([], [core, lib2])).toBe(core)
    expect(selectPrimaryProject([], [])).toBeUndefined()
  })
})
