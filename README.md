# Create Version Tags Action

Create git tags for monorepo projects based on calculated semantic versions.

## Description

This action creates git tags for your versioned projects, supporting both project-specific tags and global repository tags. It includes features like dry-run mode, tag signing, and flexible tagging strategies.

## Usage

```yaml
permissions:
  contents: write  # required for push-tags

steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0  # full history and tags

  - uses: mr-version/setup@v1

  - uses: mr-version/calculate@v1
    id: versions
    with:
      prerelease-type: rc

  - uses: mr-version/tag@v1
    with:
      projects-json: ${{ steps.versions.outputs.projects }}  # tag exactly the calculated versions
      push-tags: true
```

### Where the versions come from

- **With `projects-json`** (recommended): the `projects` output of `mr-version/calculate` is tagged as is.
  Nothing is recalculated, so the prerelease type, configuration and forced version used by calculate carry
  over (e.g. `prerelease-type: rc` tags `lib2/v1.1.1-rc.1`, not `lib2/v1.1.1`). `projects`,
  `prerelease-type`, `config-file` and `force-version` are not used.
- **Without `projects-json`**: the action calculates the versions itself, exactly like `mr-version/calculate`
  with the same `projects`, `prerelease-type`, `config-file`, `force-version` and `tag-prefix`. Use the same
  values as in your calculate step. A shallow clone fails the step (see `allow-shallow`).

### Pushing tags

Tags are created in the runner's clone and vanish with it unless pushed. With `push-tags: true` the action
runs `git push origin refs/tags/<tag>...` for exactly the tags it created (never `--tags`, so other local
tags are not pushed). The job needs `permissions: contents: write`, and `actions/checkout` must keep its
credentials (`persist-credentials: true`, the default). If any tag fails to be created, nothing is pushed
and the step fails.

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `repository-path` | Path to the Git repository root (tags are created here) | No | `.` |
| `projects-json` | The `projects` output of `mr-version/calculate` (JSON array). When set, exactly these versions are tagged and nothing is recalculated | No | - |
| `projects` | Without `projects-json`: glob patterns or project file paths to tag, separated by commas and/or newlines, relative to `repository-path` (prefix with `!` to exclude). The step fails when nothing matches | No | `**/*.csproj` |
| `prerelease-type` | Without `projects-json`: prerelease type for main/dev branches (none, alpha, beta, rc) | No | `none` |
| `config-file` | Without `projects-json`: path to `mr-version.yml` (auto-detected if not specified) | No | - |
| `force-version` | Without `projects-json`: force a specific version for all projects | No | - |
| `allow-shallow` | Without `projects-json`: calculate even if the repository is a shallow clone (otherwise the step fails) | No | `false` |
| `tag-prefix` | Prefix for version tags | No | `v` |
| `create-global-tags` | Create global tags for major releases | No | `false` |
| `global-tag-strategy` | Strategy for global tags (major-only, all, none) | No | `major-only` |
| `tag-message-template` | Template for tag messages (use {version}, {project}, {type} placeholders) | No | `Release {type} {version}` |
| `dry-run` | Show what tags would be created without creating or pushing them | No | `false` |
| `fail-on-existing` | Fail if a tag already exists | No | `false` |
| `include-test-projects` | Include test projects when creating tags | No | `false` |
| `include-non-packable` | Include non-packable projects when creating tags | No | `false` |
| `only-changed` | Only create tags for projects with version changes | No | `true` |
| `sign-tags` | Sign tags with GPG (requires git config user.signingkey) | No | `false` |
| `push-tags` | Push the tags created by this step to `origin` (requires `permissions: contents: write`) | No | `false` |

## Outputs

| Output | Description |
|--------|-------------|
| `tags-created` | JSON array of tags that were created |
| `global-tags-created` | JSON array of global tags that were created |
| `project-tags-created` | JSON array of project-specific tags that were created |
| `tags-count` | Total number of tags created |
| `tags-skipped` | Number of tags that were skipped (already exist or dry-run) |
| `tags-pushed` | JSON array of the tag names pushed to `origin` (empty unless `push-tags` is true) |

`tags-created`, `global-tags-created` and `project-tags-created` hold one object per tag considered
(`{ tagName, version, projectName, isGlobal, message, created, skipped, reason }`); use `created` to find the
tags that were actually created.

## Examples

### Basic Tag Creation

```yaml
permissions:
  contents: write

steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0
  
  - uses: mr-version/setup@v1
  
  - uses: mr-version/calculate@v1
    id: versions
  
  - uses: mr-version/tag@v1
    with:
      projects-json: ${{ steps.versions.outputs.projects }}
      push-tags: true
```

### Standalone (calculates the versions itself)

```yaml
- uses: mr-version/tag@v1
  with:
    projects: 'src/Lib1/Lib1.csproj, src/Lib2/Lib2.csproj'
    prerelease-type: rc
    push-tags: true
```

### Dry Run Mode

```yaml
steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0
  
  - uses: mr-version/setup@v1
  
  - uses: mr-version/calculate@v1
  
  - uses: mr-version/tag@v1
    id: tag
    with:
      dry-run: true
  
  - name: Show What Would Be Tagged
    run: |
      echo "Tags that would be created: ${{ steps.tag.outputs.tags-created }}"
```

### Signed Tags

```yaml
steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0
  
  - name: Import GPG Key
    run: |
      echo "${{ secrets.GPG_PRIVATE_KEY }}" | gpg --import
      git config --global user.signingkey ${{ secrets.GPG_KEY_ID }}
  
  - uses: mr-version/setup@v1
  
  - uses: mr-version/calculate@v1
  
  - uses: mr-version/tag@v1
    with:
      sign-tags: true
```

### Custom Tag Messages

```yaml
steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0
  
  - uses: mr-version/setup@v1
  
  - uses: mr-version/calculate@v1
  
  - uses: mr-version/tag@v1
    with:
      tag-message-template: |
        🚀 {project} {version} Release
        
        Type: {type}
        Date: $(date -u +"%Y-%m-%d")
```

### Selective Tagging

```yaml
steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0
  
  - uses: mr-version/setup@v1
  
  - uses: mr-version/calculate@v1
    id: versions
    with:
      projects: 'src/ProductionServices/**/*.csproj'
  
  - uses: mr-version/tag@v1
    with:
      projects-json: ${{ steps.versions.outputs.projects }}
      include-test-projects: false
      only-changed: true
```

### Global Tag Strategies

```yaml
# Only create global tags for major versions (v1.0.0, v2.0.0)
- uses: mr-version/tag@v1
  with:
    global-tag-strategy: 'major-only'

# Create global tags for all versions
- uses: mr-version/tag@v1
  with:
    global-tag-strategy: 'all'

# No global tags, only project-specific
- uses: mr-version/tag@v1
  with:
    create-global-tags: false
```

## Tag Naming Conventions

### Project-Specific Tags
Format: `{project-name}/{tag-prefix}{version}`

The project name is lower-cased. Examples:
- `myservice/v1.2.3`
- `sharedlibrary/v2.0.0`
- `webapp/v1.0.0-beta.1`

### Global Tags
Format: `{tag-prefix}{version}`

Examples:
- `v1.0.0` (major-only strategy)
- `v1.2.3` (all strategy)

## Tag Message Variables

Use these placeholders in `tag-message-template`:
- `{version}` - The version number (e.g., "1.2.3")
- `{project}` - The project name (e.g., "MyService")
- `{type}` - The project name for project tags, `Global` for global tags

## Advanced Configuration

### Conditional Tagging

```yaml
steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0
  
  - uses: mr-version/setup@v1
  
  - uses: mr-version/calculate@v1
    id: versions
  
  - uses: mr-version/tag@v1
    if: steps.versions.outputs.has-changes == 'true'
    with:
      fail-on-existing: true
```

### Post-Tag Actions

```yaml
steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0
  
  - uses: mr-version/setup@v1
  
  - uses: mr-version/calculate@v1
  
  - uses: mr-version/tag@v1
    id: tagger
    with:
      push-tags: true
  
  - name: Create Releases
    env:
      GH_TOKEN: ${{ github.token }}
      TAGS: ${{ steps.tagger.outputs.tags-pushed }}
    run: |
      echo "$TAGS" | jq -r '.[]' | while read tag; do
        gh release create "$tag" --generate-notes
      done
```

## Error Handling

### Tag Already Exists

By default, existing tags are skipped. To fail on existing tags:

```yaml
- uses: mr-version/tag@v1
  with:
    fail-on-existing: true
```

### Push Failures

`git push origin refs/tags/... failed`: give the job `permissions: contents: write` and keep
`actions/checkout`'s default `persist-credentials: true`. Protected tag rules can also reject the push.

### Shallow Clone Error

Without `projects-json` the action calculates versions and refuses a shallow clone; use `actions/checkout`
with `fetch-depth: 0` (or set `allow-shallow: true`).

### GPG Signing Failures

Ensure GPG is properly configured:

```yaml
- name: Setup GPG
  run: |
    gpg --list-secret-keys
    git config --global gpg.program $(which gpg)
    git config --global commit.gpgsign true
    git config --global tag.gpgsign true
```

## Best Practices

1. **Always use dry-run first** in production workflows
2. **Store GPG keys securely** in GitHub secrets
3. **Use descriptive tag messages** with templates
4. **Implement tag protection rules** in your repository
5. **Push tags with `push-tags: true`** (and `permissions: contents: write`) so they outlive the runner

## License

This action is part of the Mister.Version project and is licensed under the MIT License.