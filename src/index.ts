import * as core from '@actions/core'
import { SummaryTableCell, SummaryTableRow } from '@actions/core/lib/summary'
import * as exec from '@actions/exec'
import * as path from 'path'
import { evaluateHistory, inspectHistory } from './git'
import { ProjectVersion, calculateVersions } from './mrversion'
import { findProjectFiles } from './projects'
import {
  buildPushArgs,
  determineGlobalTags,
  filterProjects,
  formatTagMessage,
  parseProjectsJson,
  projectTagName
} from './tagging'

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

/** Like core.getBooleanInput, but an unset input means `defaultValue` instead of an error. */
function getBooleanInput(name: string, defaultValue = false): boolean {
  return core.getInput(name).trim() === '' ? defaultValue : core.getBooleanInput(name)
}

async function run(): Promise<void> {
  try {
    const repositoryPath = core.getInput('repository-path') || '.'
    const projectsInput = core.getInput('projects') || '**/*.csproj'
    const projectsJson = core.getInput('projects-json').trim()
    const tagPrefix = core.getInput('tag-prefix') || 'v'
    const prereleaseType = core.getInput('prerelease-type') || 'none'
    const configFile = core.getInput('config-file')
    const forceVersion = core.getInput('force-version')
    const createGlobalTags = getBooleanInput('create-global-tags')
    const globalTagStrategy = core.getInput('global-tag-strategy') || 'major-only'
    const tagMessageTemplate = core.getInput('tag-message-template') || 'Release {type} {version}'
    const dryRun = getBooleanInput('dry-run')
    const failOnExisting = getBooleanInput('fail-on-existing')
    const includeTestProjects = getBooleanInput('include-test-projects')
    const includeNonPackable = getBooleanInput('include-non-packable')
    const onlyChanged = getBooleanInput('only-changed', true)
    const signTags = getBooleanInput('sign-tags')
    const pushTags = getBooleanInput('push-tags')
    const allowShallow = getBooleanInput('allow-shallow')
    const repositoryRoot = path.resolve(repositoryPath)

    core.info('Creating version tags...')

    if (dryRun) {
      core.info('Running in dry-run mode - no tags will be created or pushed')
    }

    let projectVersions: ProjectVersion[]
    if (projectsJson) {
      // Tag exactly the versions mr-version/calculate produced (same prerelease type, config and forced version)
      projectVersions = parseProjectsJson(projectsJson)
      core.info(
        `Using ${projectVersions.length} project version(s) from 'projects-json'; ` +
        `'projects', 'prerelease-type', 'config-file' and 'force-version' are not used`
      )
    } else {
      projectVersions = await calculateProjectVersions({
        repositoryRoot, projectsInput, tagPrefix, prereleaseType, configFile, forceVersion, allowShallow
      })
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
      repositoryPath: repositoryRoot,
      tagPrefix,
      createGlobalTags,
      globalTagStrategy,
      tagMessageTemplate,
      dryRun,
      failOnExisting,
      signTags
    })

    const createdTagNames = result.tagsCreated.filter(t => t.created).map(t => t.tagName)
    const failedTags = result.tagsCreated.filter(t => !t.created && !t.skipped)

    // Push exactly the tags this run created
    let pushedTags: string[] = []
    if (pushTags && !dryRun && createdTagNames.length > 0 && failedTags.length === 0) {
      await pushCreatedTags(createdTagNames, repositoryRoot)
      pushedTags = createdTagNames
    } else if (pushTags && dryRun && result.tagsCreated.length > 0) {
      core.info('[DRY RUN] Would push the tags to origin')
    }

    // Set outputs
    core.setOutput('tags-created', JSON.stringify(result.tagsCreated))
    core.setOutput('global-tags-created', JSON.stringify(result.globalTags))
    core.setOutput('project-tags-created', JSON.stringify(result.projectTags))
    core.setOutput('tags-count', result.totalCount.toString())
    core.setOutput('tags-skipped', result.skippedCount.toString())
    core.setOutput('tags-pushed', JSON.stringify(pushedTags))

    // Add collapsible summary to job output
    await addJobSummary(result, dryRun, filteredProjects.length, pushedTags)

    if (failedTags.length > 0) {
      core.setFailed(
        `Failed to create ${failedTags.length} tag(s): ${failedTags.map(t => `${t.tagName} (${t.reason})`).join('; ')}` +
        (pushTags ? '. No tags were pushed.' : '')
      )
      return
    }

    const action = dryRun ? 'analyzed' : 'created'
    core.info(`✅ ${result.totalCount} tags ${action}, ${result.skippedCount} skipped${pushedTags.length > 0 ? `, ${pushedTags.length} pushed` : ''}`)

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

interface CalculateOptions {
  repositoryRoot: string
  projectsInput: string
  tagPrefix: string
  prereleaseType: string
  configFile: string
  forceVersion: string
  allowShallow: boolean
}

/** Standalone use: calculate the versions like mr-version/calculate does. */
async function calculateProjectVersions(options: CalculateOptions): Promise<ProjectVersion[]> {
  const history = await inspectHistory(options.repositoryRoot, options.tagPrefix)
  const verdict = evaluateHistory(history, options.allowShallow)
  if (verdict.level === 'error') {
    throw new Error(verdict.message)
  } else if (verdict.level === 'warning') {
    core.warning(verdict.message ?? '')
  } else if (verdict.level === 'notice') {
    core.notice(verdict.message ?? '')
  }

  const selection = await findProjectFiles(options.projectsInput, options.repositoryRoot)
  if (selection.outside.length > 0) {
    core.info(`Ignored ${selection.outside.length} project file(s) outside ${options.repositoryRoot}: ${selection.outside.join(', ')}`)
  }
  core.info(`Found ${selection.files.length} project files`)

  const calculation = await calculateVersions({
    repositoryRoot: options.repositoryRoot,
    gitRoot: history.gitRoot,
    projectFiles: selection.files,
    prereleaseType: options.prereleaseType,
    tagPrefix: options.tagPrefix,
    forceVersion: options.forceVersion,
    configFile: options.configFile
  })
  core.info(`Calculated ${calculation.projects.length} project versions (${calculation.mode}${calculation.reason ? `: ${calculation.reason}` : ''})`)
  return calculation.projects
}

async function pushCreatedTags(tagNames: string[], repositoryPath: string): Promise<void> {
  const args = buildPushArgs(tagNames)
  core.info(`Pushing ${tagNames.length} tag(s): git ${args.join(' ')}`)
  const output = await exec.getExecOutput('git', args, {
    cwd: repositoryPath,
    silent: true,
    ignoreReturnCode: true
  })
  if (output.exitCode !== 0) {
    throw new Error(
      `'git ${args.join(' ')}' failed with exit code ${output.exitCode}. The tags were created locally only. ` +
      `Make sure the job has 'permissions: contents: write' and actions/checkout kept its credentials ` +
      `(persist-credentials: true, the default).\n` +
      `${output.stderr.trim()}${output.stdout.trim() ? `\n${output.stdout.trim()}` : ''}`
    )
  }
  for (const name of tagNames) core.info(`Pushed tag: ${name}`)
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
    const projectTag = projectTagName(project.project, options.tagPrefix, project.version)
    const message = formatTagMessage(options.tagMessageTemplate, project.version, project.project, project.project)

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
    } else if (tagInfo.skipped) {
      result.skippedCount++
    }
  }

  // Create global tags if enabled
  if (options.createGlobalTags) {
    const globalTags = determineGlobalTags(options.projects, options.globalTagStrategy, options.tagPrefix)

    for (const globalTag of globalTags) {
      const message = formatTagMessage(options.tagMessageTemplate, globalTag.version, 'Global', 'Global')

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
      } else if (tagInfo.skipped) {
        result.skippedCount++
      }
    }
  }

  return result
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
      throw new Error(`git tag failed: ${(output.stderr || output.stdout).trim()}`)
    }

    tagInfo.created = true
    core.info(`Created tag: ${options.tagName}`)

  } catch (error) {
    tagInfo.reason = `Failed to create: ${error instanceof Error ? error.message : String(error)}`
    core.error(`Failed to create tag ${options.tagName}: ${error instanceof Error ? error.message : String(error)}`)
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

async function addJobSummary(result: TagCreationResult, dryRun: boolean, totalProjects: number, pushedTags: string[]): Promise<void> {
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
      `- **Failed Tags**: ${failedTags.length}\n` +
      `- **Pushed Tags**: ${pushedTags.length > 0 ? pushedTags.map(t => `\`${t}\``).join(', ') : 'none'}\n` +
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
      const status = tag.created ? '✅ Created' : (tag.skipped ? `⏭️ Skipped: ${tag.reason}` : `❌ Failed: ${tag.reason}`)
      const type = tag.isGlobal ? 'Global' : 'Project'
      tableLines.push(asTableRow(tag.tagName, type, tag.projectName, tag.version, status));
    }

    await core.summary
      .addDetails('📋 Detailed Tag Information', 
        // Convert table to markdown manually for better formatting in details
        '| Tag | Type | Project | Version | Status |\n' +
        '|-----|------|---------|---------|--------|\n' +
        result.tagsCreated.map(tag => {
          const status = tag.created ? '✅ Created' : (tag.skipped ? `⏭️ Skipped: ${tag.reason}` : `❌ Failed: ${tag.reason}`)
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
