import * as core from '@actions/core'
import { SummaryTableCell, SummaryTableRow } from '@actions/core/lib/summary'
import * as exec from '@actions/exec'
import * as glob from '@actions/glob'
import * as path from 'path'

interface ProjectVersion {
  project: string
  path: string
  version: string
  versionChanged: boolean
  changeReason?: string
  branchType?: string
  branchName?: string
  isTestProject: boolean
  isPackable: boolean
  dependencies: string[]
}

interface TagInfo {
  tagName: string
  version: string
  projectName: string
  isGlobal: boolean
  message: string
  created: boolean
  skipped: boolean
  reason?: string
}

interface TagCreationResult {
  tagsCreated: TagInfo[]
  globalTags: TagInfo[]
  projectTags: TagInfo[]
  totalCount: number
  skippedCount: number
}

async function run(): Promise<void> {
  try {
    const repositoryPath = core.getInput('repository-path') || '.'
    const projectsInput = core.getInput('projects') || '**/*.csproj'
    const tagPrefix = core.getInput('tag-prefix') || 'v'
    const createGlobalTags = core.getBooleanInput('create-global-tags')
    const globalTagStrategy = core.getInput('global-tag-strategy') || 'major-only'
    const tagMessageTemplate = core.getInput('tag-message-template') || 'Release {type} {version}'
    const dryRun = core.getBooleanInput('dry-run')
    const failOnExisting = core.getBooleanInput('fail-on-existing')
    const includeTestProjects = core.getBooleanInput('include-test-projects')
    const includeNonPackable = core.getBooleanInput('include-non-packable')
    const onlyChanged = core.getBooleanInput('only-changed')
    const signTags = core.getBooleanInput('sign-tags')

    core.info('Creating version tags...')

    if (dryRun) {
      core.info('Running in dry-run mode - no tags will be created')
    }

    // Find project files
    const projectFiles = await findProjectFiles(projectsInput, repositoryPath)
    core.info(`Found ${projectFiles.length} project files`)

    if (projectFiles.length === 0) {
      core.warning('No project files found matching the pattern')
      return
    }

    // Calculate versions for each project
    const projectVersions: ProjectVersion[] = []
    for (const projectFile of projectFiles) {
      const version = await getProjectVersion(projectFile, repositoryPath, tagPrefix)
      projectVersions.push(version)
    }

    // Filter projects based on settings
    const filteredProjects = filterProjects(projectVersions, {
      includeTestProjects,
      includeNonPackable,
      onlyChanged
    })

    core.info(`Processing ${filteredProjects.length} projects for tagging`)

    // Create tags
    const result = await createTags({
      projects: filteredProjects,
      repositoryPath,
      tagPrefix,
      createGlobalTags,
      globalTagStrategy,
      tagMessageTemplate,
      dryRun,
      failOnExisting,
      signTags
    })

    // Set outputs
    core.setOutput('tags-created', JSON.stringify(result.tagsCreated))
    core.setOutput('global-tags-created', JSON.stringify(result.globalTags))
    core.setOutput('project-tags-created', JSON.stringify(result.projectTags))
    core.setOutput('tags-count', result.totalCount.toString())
    core.setOutput('tags-skipped', result.skippedCount.toString())

    // Add collapsible summary to job output
    await addJobSummary(result, dryRun, filteredProjects.length)

    const action = dryRun ? 'analyzed' : 'created'
    core.info(`✅ ${result.totalCount} tags ${action}, ${result.skippedCount} skipped`)

  } catch (error) {
    await core.summary
      .addHeading('❌ Tag Creation Failed')
      .addDetails('🐛 Error Details',
        `\`\`\`\n${error instanceof Error ? error.message : String(error)}\n\`\`\``
      )
      .write()

    core.setFailed(`Failed to create tags: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function findProjectFiles(pattern: string, repositoryPath: string): Promise<string[]> {
  const globber = await glob.create(pattern, {
    matchDirectories: false,
    implicitDescendants: true
  })

  const files = await globber.glob()

  // Filter to only include actual project files
  return files.filter(file =>
    file.endsWith('.csproj') ||
    file.endsWith('.vbproj') ||
    file.endsWith('.fsproj')
  ).map(file => path.resolve(repositoryPath, file))
}

async function getProjectVersion(projectFile: string, repositoryPath: string, tagPrefix: string): Promise<ProjectVersion> {
  const args = [
    'version',
    '--repo', repositoryPath,
    '--project', projectFile,
    '--tag-prefix', tagPrefix,
    '--json'
  ]

  const output = await exec.getExecOutput('mr-version', args, {
    silent: true,
    ignoreReturnCode: true
  })

  if (output.exitCode !== 0) {
    throw new Error(`mr-version failed for ${projectFile}: ${output.stderr}`)
  }

  try {
    return JSON.parse(output.stdout) as ProjectVersion
  } catch (error) {
    throw new Error(`Failed to parse mr-version output for ${projectFile}: ${error}`)
  }
}

interface FilterOptions {
  includeTestProjects: boolean
  includeNonPackable: boolean
  onlyChanged: boolean
}

function filterProjects(projects: ProjectVersion[], options: FilterOptions): ProjectVersion[] {
  return projects.filter(project => {
    // Filter test projects
    if (!options.includeTestProjects && project.isTestProject) {
      return false
    }

    // Filter non-packable projects
    if (!options.includeNonPackable && !project.isPackable) {
      return false
    }

    // Filter unchanged projects
    if (options.onlyChanged && !project.versionChanged) {
      return false
    }

    return true
  })
}

interface CreateTagsOptions {
  projects: ProjectVersion[]
  repositoryPath: string
  tagPrefix: string
  createGlobalTags: boolean
  globalTagStrategy: string
  tagMessageTemplate: string
  dryRun: boolean
  failOnExisting: boolean
  signTags: boolean
}

async function createTags(options: CreateTagsOptions): Promise<TagCreationResult> {
  const result: TagCreationResult = {
    tagsCreated: [],
    globalTags: [],
    projectTags: [],
    totalCount: 0,
    skippedCount: 0
  }

  // Create project-specific tags
  for (const project of options.projects) {
    const projectTag = `${project.project.toLowerCase()}/${options.tagPrefix}${project.version}`
    const message = options.tagMessageTemplate
      .replace('{version}', project.version)
      .replace('{project}', project.project)
      .replace('{type}', project.project)

    const tagInfo = await createTag({
      tagName: projectTag,
      message,
      projectName: project.project,
      version: project.version,
      isGlobal: false,
      repositoryPath: options.repositoryPath,
      dryRun: options.dryRun,
      failOnExisting: options.failOnExisting,
      signTags: options.signTags
    })

    result.tagsCreated.push(tagInfo)
    result.projectTags.push(tagInfo)

    if (tagInfo.created) {
      result.totalCount++
    } else {
      result.skippedCount++
    }
  }

  // Create global tags if enabled
  if (options.createGlobalTags) {
    const globalTags = determineGlobalTags(options.projects, options.globalTagStrategy, options.tagPrefix)

    for (const globalTag of globalTags) {
      const message = options.tagMessageTemplate
        .replace('{version}', globalTag.version)
        .replace('{project}', 'Global')
        .replace('{type}', 'Global')

      const tagInfo = await createTag({
        tagName: globalTag.tagName,
        message,
        projectName: 'Global',
        version: globalTag.version,
        isGlobal: true,
        repositoryPath: options.repositoryPath,
        dryRun: options.dryRun,
        failOnExisting: options.failOnExisting,
        signTags: options.signTags
      })

      result.tagsCreated.push(tagInfo)
      result.globalTags.push(tagInfo)

      if (tagInfo.created) {
        result.totalCount++
      } else {
        result.skippedCount++
      }
    }
  }

  return result
}

function determineGlobalTags(projects: ProjectVersion[], strategy: string, tagPrefix: string): { tagName: string; version: string }[] {
  const globalTags: { tagName: string; version: string }[] = []

  for (const project of projects) {
    const version = project.version
    const versionParts = version.split('.')

    if (versionParts.length < 3) continue

    const minor = parseInt(versionParts[1])
    const patch = parseInt(versionParts[2])

    let shouldCreateGlobalTag = false

    switch (strategy.toLowerCase()) {
      case 'major-only':
        shouldCreateGlobalTag = minor === 0 && patch === 0
        break
      case 'all':
        shouldCreateGlobalTag = true
        break
      case 'none':
        shouldCreateGlobalTag = false
        break
    }

    if (shouldCreateGlobalTag) {
      const globalTagName = `${tagPrefix}${version}`

      // Avoid duplicates
      if (!globalTags.some(tag => tag.tagName === globalTagName)) {
        globalTags.push({
          tagName: globalTagName,
          version: version
        })
      }
    }
  }

  return globalTags
}

interface CreateTagOptions {
  tagName: string
  message: string
  projectName: string
  version: string
  isGlobal: boolean
  repositoryPath: string
  dryRun: boolean
  failOnExisting: boolean
  signTags: boolean
}

async function createTag(options: CreateTagOptions): Promise<TagInfo> {
  const tagInfo: TagInfo = {
    tagName: options.tagName,
    version: options.version,
    projectName: options.projectName,
    isGlobal: options.isGlobal,
    message: options.message,
    created: false,
    skipped: false
  }

  // Check if tag already exists
  const tagExists = await checkTagExists(options.tagName, options.repositoryPath)

  if (tagExists) {
    tagInfo.skipped = true
    tagInfo.reason = 'Tag already exists'

    if (options.failOnExisting) {
      throw new Error(`Tag ${options.tagName} already exists`)
    }

    core.warning(`Tag ${options.tagName} already exists, skipping`)
    return tagInfo
  }

  if (options.dryRun) {
    tagInfo.skipped = true
    tagInfo.reason = 'Dry run mode'
    core.info(`[DRY RUN] Would create tag: ${options.tagName}`)
    return tagInfo
  }

  // Configure git identity if not already set
  try {
    const emailCheck = await exec.getExecOutput('git', ['config', 'user.email'], {
      cwd: options.repositoryPath,
      silent: true,
      ignoreReturnCode: true
    })

    if (emailCheck.exitCode !== 0 || !emailCheck.stdout.trim()) {
      await exec.getExecOutput('git', ['config', 'user.email', 'actions@github.com'], {
        cwd: options.repositoryPath,
        silent: true
      })
      await exec.getExecOutput('git', ['config', 'user.name', 'GitHub Actions'], {
        cwd: options.repositoryPath,
        silent: true
      })
    }
  } catch (error) {
    await exec.getExecOutput('git', ['config', 'user.email', 'actions@github.com'], {
      cwd: options.repositoryPath,
      silent: true
    })
    await exec.getExecOutput('git', ['config', 'user.name', 'GitHub Actions'], {
      cwd: options.repositoryPath,
      silent: true
    })
  }

  // Create the tag
  try {
    const args = ['tag']

    if (options.signTags) {
      args.push('-s')
    }

    args.push('-m', options.message, options.tagName)

    const output = await exec.getExecOutput('git', args, {
      cwd: options.repositoryPath,
      silent: true,
      ignoreReturnCode: true
    })

    if (output.exitCode !== 0) {
      throw new Error(`Git tag creation failed: ${output.stderr}`)
    }

    tagInfo.created = true
    core.info(`Created tag: ${options.tagName}`)

  } catch (error) {
    tagInfo.skipped = true
    tagInfo.reason = `Failed to create: ${error}`
    core.error(`Failed to create tag ${options.tagName}: ${error}`)
  }

  return tagInfo
}

async function checkTagExists(tagName: string, repositoryPath: string): Promise<boolean> {
  try {
    const output = await exec.getExecOutput('git', ['tag', '-l', tagName], {
      cwd: repositoryPath,
      silent: true,
      ignoreReturnCode: true
    })

    return output.stdout.trim() === tagName
  } catch {
    return false
  }
}

const asTableHeaderRow = (...data: string[]): SummaryTableRow => data.map(d => asSummaryTableCell(d, true))

const asTableRow = (...data: (string | number)[]): SummaryTableRow => data.map(d => asSummaryTableCell(`${d}`, false));

const asSummaryTableCell = (data: string, header?: boolean): SummaryTableCell => ({ data, header: header ?? false });

async function addJobSummary(result: TagCreationResult, dryRun: boolean, totalProjects: number): Promise<void> {
  const createdTags = result.tagsCreated.filter(t => t.created)
  const skippedTags = result.tagsCreated.filter(t => t.skipped)
  const failedTags = result.tagsCreated.filter(t => !t.created && !t.skipped)

  await core.summary
    .addHeading(`🏷️ Tag Creation ${dryRun ? 'Analysis' : 'Results'}`)
    .addDetails('📊 Summary Statistics', 
      `- **Total Projects**: ${totalProjects}\n` +
      `- **Tags ${dryRun ? 'Analyzed' : 'Created'}**: ${result.totalCount}\n` +
      `- **Project Tags**: ${result.projectTags.length}\n` +
      `- **Global Tags**: ${result.globalTags.length}\n` +
      `- **Skipped Tags**: ${result.skippedCount}\n` +
      `- **Mode**: ${dryRun ? '🧪 Dry Run' : '🚀 Live'}`
    )

  if (createdTags.length > 0) {
    await core.summary
      .addDetails('✅ Successfully Created Tags',
        createdTags.map(tag => 
          `- **${tag.tagName}** (${tag.isGlobal ? 'Global' : tag.projectName}) - \`${tag.version}\``
        ).join('\n')
      )
  }

  if (skippedTags.length > 0) {
    await core.summary
      .addDetails('⏭️ Skipped Tags',
        skippedTags.map(tag => 
          `- **${tag.tagName}** (${tag.isGlobal ? 'Global' : tag.projectName}) - _${tag.reason}_`
        ).join('\n')
      )
  }

  if (failedTags.length > 0) {
    await core.summary
      .addDetails('❌ Failed Tags',
        failedTags.map(tag => 
          `- **${tag.tagName}** (${tag.isGlobal ? 'Global' : tag.projectName}) - _${tag.reason}_`
        ).join('\n')
      )
  }

  if (result.tagsCreated.length > 0) {
    // Create detailed table in collapsible section
    const tableLines: SummaryTableRow[] = [
      asTableHeaderRow('Tag', 'Type', 'Project', 'Version', 'Status')
    ]

    for (const tag of result.tagsCreated) {
      const status = tag.created ? '✅ Created' : (tag.skipped ? `⏭️ Skipped: ${tag.reason}` : '❌ Failed')
      const type = tag.isGlobal ? 'Global' : 'Project'
      tableLines.push(asTableRow(tag.tagName, type, tag.projectName, tag.version, status));
    }

    await core.summary
      .addDetails('📋 Detailed Tag Information', 
        // Convert table to markdown manually for better formatting in details
        '| Tag | Type | Project | Version | Status |\n' +
        '|-----|------|---------|---------|--------|\n' +
        result.tagsCreated.map(tag => {
          const status = tag.created ? '✅ Created' : (tag.skipped ? `⏭️ Skipped: ${tag.reason}` : '❌ Failed')
          const type = tag.isGlobal ? 'Global' : 'Project'
          return `| \`${tag.tagName}\` | ${type} | ${tag.projectName} | \`${tag.version}\` | ${status} |`
        }).join('\n')
      )
  }

  if (dryRun) {
    await core.summary
      .addQuote('**Dry Run Mode** - No tags were actually created. This was a preview of what would happen.')
  }

  await core.summary.write()
}

// Run the action
if (require.main === module) {
  run()
}

export { run }