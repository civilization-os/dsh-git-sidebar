/**
 * @civilization/dsh-git-sidebar — Host plugin (Node.js).
 *
 * Implements self-contained Git RPC endpoints under `/dsh-git/api` and `/sidebar/api`.
 * Completely independent of dsh-better-sidebar.
 */
import type { Context } from '@deepseek-ai/cordis'
import * as git from './git.js'

export const name = '@civilization/dsh-git-sidebar'
export const inject = ['webServer']

async function readJsonBody(req: any): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8') })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function writeJson(res: any, status: number, body: any): void {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
  })
  res.end(data)
}

function targetCwd(payload: Record<string, any>): string {
  return payload.repoRoot || payload.cwd || process.cwd()
}

const GIT_METHODS: Record<string, (payload: Record<string, any>) => Promise<any>> = {
  'git.status': async (payload) => {
    return git.status(targetCwd(payload), payload.repoRoot)
  },
  'git.diff': async (payload) => {
    const d = await git.diff(targetCwd(payload), payload.path, payload.staged === true, payload.repoRoot)
    return { diff: d }
  },
  'git.stage': async (payload) => {
    await git.stage(targetCwd(payload), payload.path, payload.repoRoot)
    return { ok: true }
  },
  'git.unstage': async (payload) => {
    await git.unstage(targetCwd(payload), payload.path, payload.repoRoot)
    return { ok: true }
  },
  'git.commit': async (payload) => {
    await git.commit(targetCwd(payload), String(payload.message || ''), payload.repoRoot)
    return { ok: true }
  },
  'git.branch': async (payload) => {
    return git.branches(targetCwd(payload), payload.repoRoot)
  },
  'git.checkout': async (payload) => {
    await git.checkout(targetCwd(payload), String(payload.branch || ''), payload.repoRoot)
    return { ok: true }
  },
  'git.log': async (payload) => {
    const count = typeof payload.count === 'number' ? payload.count : 30
    const skip = typeof payload.skip === 'number' ? payload.skip : 0
    return git.log(targetCwd(payload), count, skip, payload.repoRoot)
  },
  'git.commit-diff': async (payload) => {
    const d = await git.commitDiff(targetCwd(payload), String(payload.hash || ''), payload.repoRoot)
    return { diff: d }
  },
  'git.discard': async (payload) => {
    await git.discard(targetCwd(payload), String(payload.path || ''), payload.repoRoot)
    return { ok: true }
  },
  'git.sync-status': async (payload) => {
    return git.syncStatus(targetCwd(payload), payload.repoRoot)
  },
  'git.fetch': async (payload) => {
    await git.fetch(targetCwd(payload), payload.repoRoot)
    return { ok: true }
  },
  'git.pull': async (payload) => {
    await git.pull(targetCwd(payload), payload.repoRoot)
    return { ok: true }
  },
  'git.push': async (payload) => {
    await git.push(targetCwd(payload), payload.repoRoot)
    return { ok: true }
  },
  'git.create-branch': async (payload) => {
    await git.createBranch(targetCwd(payload), String(payload.branch || ''), payload.repoRoot)
    return { ok: true }
  },
  'git.stash': async (payload) => {
    await git.stash(targetCwd(payload), payload.message ? String(payload.message) : undefined, payload.repoRoot)
    return { ok: true }
  },
  'git.stash-pop': async (payload) => {
    await git.stashPop(targetCwd(payload), typeof payload.index === 'number' ? payload.index : undefined, payload.repoRoot)
    return { ok: true }
  },
  'git.stash-list': async (payload) => {
    return { entries: await git.stashList(targetCwd(payload), payload.repoRoot) }
  },
  'git.apply-patch': async (payload) => {
    await git.applyPatch(targetCwd(payload), String(payload.patch || ''), payload.reverse === true, payload.repoRoot)
    return { ok: true }
  },
}

export function apply(ctx: Context): void {
  const webServer = (ctx as any).webServer
  if (!webServer) return

  const handleRpc = async (req: any, res: any, prefix: string) => {
    if (req.method !== 'POST') {
      writeJson(res, 405, { ok: false, error: { message: 'Method Not Allowed' } })
      return
    }
    const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
    const method = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : undefined
    if (!method || !GIT_METHODS[method]) {
      writeJson(res, 404, { ok: false, error: { message: `Unknown Git method: ${method}` } })
      return
    }

    try {
      const payload = await readJsonBody(req)
      const result = await GIT_METHODS[method](payload)
      writeJson(res, 200, { ok: true, value: result })
    } catch (err: any) {
      writeJson(res, 500, { ok: false, error: { message: err?.message || String(err) } })
    }
  }

  // Register prefix route for /dsh-git/api/
  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: '/dsh-git/api',
    handler: (req: any, res: any) => handleRpc(req, res, '/dsh-git/api/'),
  }), 'dsh-git-sidebar: /dsh-git/api routes')

  // Register prefix fallback for /sidebar/api/
  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: '/sidebar/api',
    handler: (req: any, res: any) => handleRpc(req, res, '/sidebar/api/'),
  }), 'dsh-git-sidebar: /sidebar/api fallback routes')
}
