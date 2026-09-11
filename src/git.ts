/**
 * Git operations for dsh-git-sidebar (Node host runtime).
 *
 * Direct execution via system `git` CLI (spawn), using porcelain-parseable
 * formats (-z NUL framing, machine formats) so parsing is robust across locales.
 */
import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

export interface GitStatusEntry {
  path: string
  xy: string
}

export interface GitStatusResult {
  isRepo: boolean
  branch?: string
  entries: GitStatusEntry[]
  truncated?: boolean
  root?: string
  repositories?: string[]
}

export interface GitLogEntry {
  hash: string
  hashFull: string
  subject: string
  author: string
  date: string
  refs: string
}

export class GitCommandError extends Error {
  readonly code: string
  readonly command: string
  constructor(
    message: string,
    code = 'git-error',
    command = '',
  ) {
    super(message)
    this.code = code
    this.command = command
  }
}

export function parsePorcelainZ(output: string): GitStatusEntry[] {
  const tokens = output.split('\0')
  const entries: GitStatusEntry[] = []
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index]!
    index += 1
    if (token === '') continue
    const xy = token.slice(0, 2)
    const rest = token.slice(3)
    entries.push({ path: rest, xy })
    if ((xy[0] === 'R' || xy[0] === 'C') && tokens[index] !== undefined && tokens[index] !== '') {
      index += 1
    }
  }
  return entries
}

export function parseLogLines(output: string): GitLogEntry[] {
  const rows: GitLogEntry[] = []
  for (const line of output.split('\n')) {
    if (line === '') continue
    const [hash, subject, author, date, hashFull, refs] = line.split('\x1f')
    if (hash === undefined || subject === undefined) continue
    rows.push({
      hash,
      subject,
      author: author ?? '',
      date: date ?? '',
      hashFull: hashFull ?? hash,
      refs: refs ?? '',
    })
  }
  return rows
}

function runGit(cwd: string, args: string[], timeoutMs = 30_000, input?: string): Promise<string> {
  const full = ['-C', cwd, '--no-pager', '-c', 'color.ui=false', ...args]
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn('git', full, {
      stdio: [input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    })
    if (input !== undefined && child.stdin) {
      child.stdin.end(input, 'utf8')
    }
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new GitCommandError(`git ${args[0] ?? ''} timed out after ${timeoutMs}ms`, 'git-error', args.join(' ')))
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (error: Error) => {
      clearTimeout(timer)
      reject(new GitCommandError(`cannot run git: ${error.message}`, 'git-error', args.join(' ')))
    })
    child.on('close', (code: number | null) => {
      clearTimeout(timer)
      if (code === 0) {
        resolvePromise(stdout)
      } else {
        reject(new GitCommandError(stderr.trim() || `git exited with ${String(code)}`, 'git-error', args.join(' ')))
      }
    })
  })
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const out = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], 5000)
    return out.trim() === 'true'
  } catch {
    return false
  }
}

export async function repoRoot(cwd: string, selected?: string): Promise<string> {
  if (selected) {
    if (await isGitRepo(selected)) return resolve(selected)
  }
  const out = await runGit(cwd, ['rev-parse', '--show-toplevel'])
  return resolve(out.trim())
}

export async function repoRoots(cwd: string): Promise<string[]> {
  if (await isGitRepo(cwd)) {
    try {
      const top = await repoRoot(cwd)
      return [top]
    } catch {
      return [cwd]
    }
  }
  // Try immediate child directories
  try {
    const entries = await readdir(cwd, { withFileTypes: true })
    const roots: string[] = []
    for (const ent of entries.slice(0, 50)) {
      if (ent.isDirectory()) {
        const full = join(cwd, ent.name)
        if (await isGitRepo(full)) roots.push(full)
      }
    }
    return roots
  } catch {
    return []
  }
}

export async function currentBranch(cwd: string): Promise<string> {
  const out = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return out.trim()
}

const GIT_STATUS_LIMIT = 2_000

export async function status(cwd: string, selected?: string): Promise<GitStatusResult> {
  const repositories = await repoRoots(cwd)
  if (repositories.length === 0) return { isRepo: false, entries: [], repositories: [] }
  const root = await repoRoot(cwd, selected).catch(() => repositories[0]!)
  const [branch, raw] = await Promise.all([
    currentBranch(root).catch(() => 'HEAD'),
    runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  ])
  const parsed = parsePorcelainZ(raw)
  const truncated = parsed.length > GIT_STATUS_LIMIT
  return {
    isRepo: true,
    branch,
    entries: truncated ? parsed.slice(0, GIT_STATUS_LIMIT) : parsed,
    truncated,
    root,
    repositories,
  }
}

export async function diff(cwd: string, path: string | undefined, staged: boolean, selected?: string): Promise<string> {
  const root = await repoRoot(cwd, selected)
  const args = ['diff', '--no-ext-diff', '--no-color', '-U3']
  if (staged) args.push('--cached')
  if (path !== undefined) args.push('--', path)
  return runGit(root, args)
}

export async function stage(cwd: string, path: string | undefined, selected?: string): Promise<void> {
  const root = await repoRoot(cwd, selected)
  await runGit(root, ['add', '-A', ...(path !== undefined ? ['--', path] : [])])
}

export async function unstage(cwd: string, path: string | undefined, selected?: string): Promise<void> {
  const root = await repoRoot(cwd, selected)
  await runGit(root, ['reset', '-q', ...(path !== undefined ? ['--', path] : [])])
}

export async function commit(cwd: string, message: string, selected?: string): Promise<void> {
  const root = await repoRoot(cwd, selected)
  await runGit(root, ['commit', '-m', message])
}

export async function branches(cwd: string, selected?: string): Promise<{ current: string; names: string[] }> {
  const root = await repoRoot(cwd, selected)
  const [current, raw] = await Promise.all([
    currentBranch(root).catch(() => 'HEAD'),
    runGit(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
  ])
  const names = raw.split('\n').filter(line => line !== '')
  return { current, names: names.includes(current) ? names : [current, ...names] }
}

export async function checkout(cwd: string, branch: string, selected?: string): Promise<void> {
  const root = await repoRoot(cwd, selected)
  await runGit(root, ['checkout', branch])
}

export async function log(cwd: string, count = 30, skip = 0, selected?: string): Promise<GitLogEntry[]> {
  const root = await repoRoot(cwd, selected)
  const raw = await runGit(root, [
    'log', '-n', String(count), '--skip', String(skip), '--decorate=short',
    '--pretty=format:%h%x1f%s%x1f%an%x1f%ai%x1f%H%x1f%D',
  ])
  return parseLogLines(raw)
}

export async function show(cwd: string, rev: string, path: string, selected?: string): Promise<string | null> {
  try {
    const root = await repoRoot(cwd, selected)
    return await runGit(root, ['show', `${rev}:${path}`])
  } catch {
    return null
  }
}

export async function commitDiff(cwd: string, hash: string, selected?: string): Promise<string> {
  const root = await repoRoot(cwd, selected)
  return runGit(root, ['show', '--no-ext-diff', '--no-color', '--format=', '-m', '--first-parent', hash])
}

export async function discard(cwd: string, path: string, selected?: string): Promise<void> {
  const root = await repoRoot(cwd, selected)
  // 检查目标文件的 git 状态
  const rawStatus = await runGit(root, ['status', '--porcelain=v1', '-z', '--', path]).catch(() => '')
  const parsed = parsePorcelainZ(rawStatus)
  const isUntracked = parsed.some(e => e.xy === '??' || e.xy.trim() === '?')
  const isStagedNew = parsed.some(e => e.xy[0] === 'A')

  if (isUntracked) {
    await runGit(root, ['clean', '-f', '-d', '--', path])
  } else if (isStagedNew) {
    await runGit(root, ['reset', '-q', '--', path]).catch(() => {})
    await runGit(root, ['clean', '-f', '-d', '--', path]).catch(() => {})
  } else {
    await runGit(root, ['checkout', '--', path])
  }
}

export interface GitSyncStatus {
  hasRemote: boolean
  upstream?: string
  ahead: number
  behind: number
}

export async function syncStatus(cwd: string, selected?: string): Promise<GitSyncStatus> {
  const root = await repoRoot(cwd, selected)
  const remotesRaw = await runGit(root, ['remote']).catch(() => '')
  const hasRemote = remotesRaw.trim().length > 0

  let upstream: string | undefined
  try {
    const up = await runGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
    upstream = up.trim() || undefined
  } catch {
    upstream = undefined
  }

  let ahead = 0
  let behind = 0
  if (upstream) {
    try {
      const counts = await runGit(root, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`])
      const [left, right] = counts.trim().split(/\s+/)
      ahead = Number.parseInt(left ?? '0', 10) || 0
      behind = Number.parseInt(right ?? '0', 10) || 0
    } catch {}
  }

  return { hasRemote, upstream, ahead, behind }
}

export async function fetch(cwd: string, selected?: string): Promise<void> {
  const root = await repoRoot(cwd, selected)
  await runGit(root, ['fetch'], 60_000)
}

export async function pull(cwd: string, selected?: string): Promise<void> {
  const root = await repoRoot(cwd, selected)
  await runGit(root, ['pull'], 60_000)
}

export async function push(cwd: string, selected?: string): Promise<void> {
  const root = await repoRoot(cwd, selected)
  const branch = await currentBranch(root)
  const status = await syncStatus(cwd, selected)
  if (!status.upstream && status.hasRemote) {
    await runGit(root, ['push', '-u', 'origin', branch], 60_000)
  } else {
    await runGit(root, ['push'], 60_000)
  }
}

export async function createBranch(cwd: string, branch: string, selected?: string): Promise<void> {
  const root = await repoRoot(cwd, selected)
  const name = branch.trim()
  if (!name) throw new Error('Branch name cannot be empty')
  await runGit(root, ['checkout', '-b', name])
}

export interface GitStashEntry {
  index: number
  message: string
  date: string
}

export async function stash(cwd: string, message?: string, selected?: string): Promise<void> {
  const root = await repoRoot(cwd, selected)
  const args = ['stash', 'push', '--include-untracked']
  if (message?.trim()) {
    args.push('-m', message.trim())
  }
  await runGit(root, args)
}

export async function stashPop(cwd: string, index?: number, selected?: string): Promise<void> {
  const root = await repoRoot(cwd, selected)
  const target = index !== undefined ? `stash@{${index}}` : 'stash@{0}'
  await runGit(root, ['stash', 'pop', target])
}

export async function stashList(cwd: string, selected?: string): Promise<GitStashEntry[]> {
  const root = await repoRoot(cwd, selected)
  const raw = await runGit(root, ['stash', 'list', '--format=%gd%x1f%gs%x1f%ci']).catch(() => '')
  const rows: GitStashEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const [gd, gs, ci] = line.split('\x1f')
    const match = gd?.match(/stash@\{(\d+)\}/)
    const index = match ? Number.parseInt(match[1]!, 10) : rows.length
    rows.push({
      index,
      message: gs ?? '',
      date: ci ?? '',
    })
  }
  return rows
}

export async function applyPatch(cwd: string, patch: string, reverse = false, selected?: string): Promise<void> {
  const root = await repoRoot(cwd, selected)
  const args = ['apply', '--cached', '--unidiff-zero']
  if (reverse) args.push('--reverse')
  args.push('-')
  await runGit(root, args, 15_000, patch)
}

