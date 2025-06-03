# Create Version Tags Action

Create git tags for monorepo projects based on calculated semantic versions.

## Description

This action creates git tags for your versioned projects, supporting both project-specific tags and global repository tags. It includes features like dry-run mode, tag signing, and flexible tagging strategies.

## Usage

```yaml
- uses: mr-version/tag@v1
  with:
    create-global-tags: true
    sign-tags: true
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `repository-path` | Path to the Git repository root | No | `.` |
| `projects` | Glob pattern or comma-separated list of project files to tag | No | `**/*.csproj` |
| `tag-prefix` | Prefix for version tags | No | `v` |
| `create-global-tags` | Create global tags for major releases | No | `true` |
| `global-tag-strategy` | Strategy for global tags (major-only, all, none) | No | `major-only` |
| `tag-message-template` | Template for tag messages (use {version}, {project}, {type} placeholders) | No | `Release {type} {version}` |
| `dry-run` | Show what tags would be created without actually creating them | No | `false` |
| `fail-on-existing` | Fail if a tag already exists | No | `false` |
| `include-test-projects` | Include test projects when creating tags | No | `false` |
| `include-non-packable` | Include non-packable projects when creating tags | No | `false` |
| `only-changed` | Only create tags for projects with version changes | No | `true` |
| `sign-tags` | Sign tags with GPG (requires git config user.signingkey) | No | `false` |

## Outputs

| Output | Description |
|--------|-------------|
| `tags-created` | JSON array of tags that were created |
| `global-tags-created` | JSON array of global tags that were created |
| `project-tags-created` | JSON array of project-specific tags that were created |
| `tags-count` | Total number of tags created |
| `tags-skipped` | Number of tags that were skipped (already exist or dry-run) |

## Examples

### Basic Tag Creation

```yaml
steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0
  
  - uses: mr-version/setup@v1
  
  - uses: mr-version/calculate@v1
  
  - uses: mr-version/tag@v1
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
    with:
      projects: 'src/ProductionServices/**/*.csproj'
  
  - uses: mr-version/tag@v1
    with:
      projects: 'src/ProductionServices/**/*.csproj'
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

Examples:
- `MyService/v1.2.3`
- `SharedLibrary/v2.0.0`
- `WebApp/v1.0.0-beta.1`

### Global Tags
Format: `{tag-prefix}{version}`

Examples:
- `v1.0.0` (major-only strategy)
- `v1.2.3` (all strategy)

## Tag Message Variables

Use these placeholders in `tag-message-template`:
- `{version}` - The version number (e.g., "1.2.3")
- `{project}` - The project name (e.g., "MyService")
- `{type}` - The version bump type (e.g., "major", "minor", "patch")

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
  
  - name: Push Tags
    if: steps.tagger.outputs.tags-count > 0
    run: |
      git push origin --tags
  
  - name: Create Releases
    run: |
      echo '${{ steps.tagger.outputs.tags-created }}' | jq -r '.[]' | while read tag; do
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
5. **Automate tag pushing** after successful creation

## License

This action is part of the Mister.Version project and is licensed under the MIT License.