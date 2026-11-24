import { describe, expect, it } from '@jest/globals'
import { countVersionTags, evaluateHistory } from '../git'

describe('countVersionTags', () => {
  it('counts global and project version tags with the prefix', () => {
    expect(countVersionTags(['v1.0.0', 'lib1/v1.0.2', 'app/v1.0.2', 'nightly', 'vnext', ''], 'v')).toBe(3)
  })

  it('handles empty and special-character prefixes', () => {
    expect(countVersionTags(['1.0.0', 'core/2.0.0', 'v1.0.0'], '')).toBe(2)
    expect(countVersionTags(['rel+1.0.0', 'relx1.0.0'], 'rel+')).toBe(1)
  })
})

describe('evaluateHistory', () => {
  const base = { gitRoot: '/work/repo', shallow: false, reachableVersionTags: 3, totalTags: 5 }

  it('accepts a full clone with tags', () => {
    expect(evaluateHistory(base, false)).toEqual({ level: 'ok' })
  })

  it('fails a shallow clone, pointing at fetch-depth: 0 and allow-shallow', () => {
    const verdict = evaluateHistory({ ...base, shallow: true, reachableVersionTags: 0, totalTags: 0 }, false)
    expect(verdict.level).toBe('error')
    expect(verdict.message).toContain('shallow clone')
    expect(verdict.message).toContain('no version tag is reachable')
    expect(verdict.message).toContain('fetch-depth: 0')
    expect(verdict.message).toContain('allow-shallow: true')
  })

  it('fails a shallow clone even when some tags are reachable', () => {
    expect(evaluateHistory({ ...base, shallow: true }, false).level).toBe('error')
  })

  it('only warns for a shallow clone when allow-shallow is set', () => {
    const verdict = evaluateHistory({ ...base, shallow: true }, true)
    expect(verdict.level).toBe('warning')
    expect(verdict.message).not.toContain('allow-shallow')
  })

  it('adds a notice for a full clone without any tags', () => {
    expect(evaluateHistory({ ...base, reachableVersionTags: 0, totalTags: 0 }, false).level).toBe('notice')
  })
})
