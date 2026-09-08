/** Browser entry for the Git sidebar and unified-diff viewer. */
import type { Context } from '@deepseek-ai/cordis'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type {} from 'dsh-better-sidebar'
import type { FileViewerProps, SessionScope, SidebarStore, SidebarTab, TabComponentProps } from 'dsh-better-sidebar/client/service'

export const inject = ['betterSidebar']

const GIT_ID = 'dsh-git-sidebar:git'
const DIFF_ID = 'dsh-git-sidebar:diff'
const DIFF_TAB_ID = 'dsh-git-sidebar:diff-view'
const EMPTY_SETTINGS: Record<string, unknown> = Object.freeze({})

interface GitStatusEntry { path: string; xy: string }
interface GitStatusResult { isRepo: boolean; branch?: string; entries: GitStatusEntry[]; truncated?: boolean; root?: string }
interface GitLogEntry { hash: string; hashFull: string; subject: string; author: string; date: string; refs: string }
type DiffTarget = { kind: 'change'; entry: GitStatusEntry; staged: boolean } | { kind: 'commit'; entry: GitLogEntry }
interface DetachedDiffMeta { target: DiffTarget; repoRoot?: string }

export function apply(ctx: Context): void {
  const betterSidebar = ctx.betterSidebar
  if (!betterSidebar) return
  ctx.effect(() => betterSidebar.registerTab({
    id: GIT_ID,
    title: () => 'Git',
    icon: <span aria-hidden style={{ fontSize: 15 }}>⑂</span>,
    order: 60,
    single: true,
    settings: { pluginToggles: [
      { key: 'pauseAutoRefresh', title: '暂停自动刷新', desc: '默认会在 Git 页签可见时刷新；开启后仅手动刷新。' },
      { key: 'hideUntracked', title: '隐藏未跟踪文件', desc: '从更改列表中隐藏 Git 尚未跟踪的文件。' },
      { key: 'refreshSeconds', type: 'number', min: 2, max: 60, unit: '秒', title: '刷新间隔' },
      { key: 'historyLimit', type: 'number', min: 5, max: 100, title: '历史数量' },
      { key: 'diffLayout', type: 'select', title: 'Diff 默认布局', options: [{ value: 'unified', title: '单栏（统一视图）' }, { value: 'split', title: '双栏（旧文件 / 新文件）' }] },
      { key: 'openMode', type: 'select', title: '点击变更时', options: [{ value: 'preview', title: '先在 Git 内预览' }, { value: 'detached', title: '直接打开独立 Diff' }] },
    ] },
    component: GitSidebar,
  }))
  ctx.effect(() => betterSidebar.registerTab({
    id: DIFF_TAB_ID,
    title: () => 'Diff',
    icon: <span aria-hidden>±</span>,
    hidden: true,
    dedupeKey: tab => tab.id,
    component: DetachedDiff,
  }))
  ctx.effect(() => betterSidebar.registerFileViewer({
    id: DIFF_ID,
    title: () => 'Diff',
    icon: <span aria-hidden>±</span>,
    exts: ['diff', 'patch'],
    fetchStrategy: 'fsRead',
    settings: { pluginToggles: [{ key: 'wrapLines', title: '自动换行', desc: '阅读较长的 Diff 行时自动折行。' }] },
    component: DiffViewer,
  }))
}

function GitSidebar({ scope, store, visible, onOpenFile, onOpenDiff }: TabComponentProps): JSX.Element {
  const prefs = usePluginSettings(store, GIT_ID)
  const autoRefresh = !boolSetting(prefs.pauseAutoRefresh, false)
  const showUntracked = !boolSetting(prefs.hideUntracked, false)
  const refreshSeconds = numberSetting(prefs.refreshSeconds, 5, 2, 60)
  const historyLimit = numberSetting(prefs.historyLimit, 20, 5, 100)
  const defaultLayout = prefs.diffLayout === 'split' ? 'split' : 'unified'
  const openMode = prefs.openMode === 'detached' ? 'detached' : 'preview'
  const [status, setStatus] = useState<GitStatusResult | null>(null)
  const [history, setHistory] = useState<GitLogEntry[]>([])
  const [mode, setMode] = useState<'changes' | 'history'>('changes')
  const [selected, setSelected] = useState<DiffTarget | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [diffLoading, setDiffLoading] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [discard, setDiscard] = useState<GitStatusEntry | null>(null)
  const request = useRef(0)
  const repoScope = useMemo<SessionScope>(() => status?.root ? { ...scope, repoRoot: status.root } : scope, [scope, status?.root])

  const refresh = useCallback(async (quiet = false) => {
    const current = ++request.current
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const nextStatus = await call<GitStatusResult>('git.status', scope)
      const nextScope = nextStatus.root ? { ...scope, repoRoot: nextStatus.root } : scope
      const nextHistory = nextStatus.isRepo
        ? await call<GitLogEntry[]>('git.log', nextScope, { count: historyLimit, skip: 0 }).catch(() => [])
        : []
      if (current !== request.current) return
      setStatus(nextStatus)
      setHistory(nextHistory)
    } catch (reason) {
      if (current === request.current) setError(messageOf(reason))
    } finally {
      if (current === request.current) setLoading(false)
    }
  }, [scope.sessionId, scope.cwd, historyLimit])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!visible || !autoRefresh) return
    const timer = window.setInterval(() => { void refresh(true) }, refreshSeconds * 1000)
    return () => window.clearInterval(timer)
  }, [visible, autoRefresh, refreshSeconds, refresh])

  const detach = useCallback((target: DiffTarget) => {
    if (!onOpenDiff) return
    const title = targetTitle(target)
    onOpenDiff({ id: detachedId(target, status?.root), type: DIFF_TAB_ID, title, meta: { target, repoRoot: status?.root } satisfies DetachedDiffMeta })
  }, [onOpenDiff, status?.root])

  const openDiff = useCallback(async (target: DiffTarget) => {
    if (openMode === 'detached' && onOpenDiff) { detach(target); return }
    setSelected(target)
    setDiffLoading(true)
    setError(null)
    try {
      setDiff(await loadTargetDiff(target, repoScope, status?.root ?? scope.cwd))
    } catch (reason) {
      setError(messageOf(reason)); setDiff(null)
    } finally { setDiffLoading(false) }
  }, [repoScope, scope.cwd, status?.root, openMode, onOpenDiff, detach])

  const mutate = async (key: string, method: string, payload: Record<string, unknown>): Promise<boolean> => {
    setBusyKey(key); setError(null)
    try {
      await call(method, repoScope, payload)
      setSelected(null); setDiff(null)
      await refresh(true)
      return true
    } catch (reason) {
      setError(messageOf(reason)); return false
    } finally { setBusyKey(null) }
  }

  const staged = (status?.entries ?? []).filter(isStaged)
  const unstaged = (status?.entries ?? []).filter(entry => isUnstaged(entry) && (showUntracked || entry.xy !== '??'))
  if (loading && status === null) return <Centered label="正在读取 Git 仓库…" />

  return <section style={s.shell}>
    <header style={s.header}>
      <div style={{ minWidth: 0 }}><div style={s.branch}><span style={s.branchMark}>⑂</span>{status?.branch ?? 'Git'}</div><div style={s.repo} title={status?.root ?? scope.cwd}>{status?.root ?? scope.cwd ?? '当前会话没有工作目录'}</div></div>
      <button type="button" style={s.iconButton} aria-label="刷新" title="刷新" onClick={() => void refresh()} disabled={loading}>↻</button>
    </header>
    <nav style={s.tabs} aria-label="Git 页面">
      <button type="button" style={mode === 'changes' ? s.tabActive : s.tab} onClick={() => setMode('changes')}>变更 <Count value={staged.length + unstaged.length} /></button>
      <button type="button" style={mode === 'history' ? s.tabActive : s.tab} onClick={() => setMode('history')}>历史</button>
    </nav>
    {error && <div style={s.error}><span>{error}</span><button style={s.errorClose} onClick={() => setError(null)}>×</button></div>}
    {!status?.isRepo ? <Empty title="这里不是 Git 仓库" detail="请在 Git 仓库中打开会话，或将会话工作目录切换到仓库。" /> : <div style={s.body}>
      <div style={s.listPane}>{mode === 'changes' ? <>
        <ChangeGroup title="已暂存" entries={staged} staged busyKey={busyKey} selected={selected} onSelect={openDiff} onToggle={entry => void mutate(`unstage:${entry.path}`, 'git.unstage', { path: entry.path })} />
        <ChangeGroup title="更改" entries={unstaged} staged={false} busyKey={busyKey} selected={selected} onSelect={openDiff} onToggle={entry => void mutate(`stage:${entry.path}`, 'git.stage', { path: entry.path })} onDiscard={setDiscard} onOpenFile={onOpenFile} />
        {status.truncated && <div style={s.notice}>变更过多，仅显示前 2000 项。</div>}
        <div style={s.commitBox}><textarea style={s.commitInput} rows={2} value={commitMessage} onChange={event => setCommitMessage(event.target.value)} placeholder="提交消息" />
          <button type="button" style={s.primaryButton} disabled={!commitMessage.trim() || staged.length === 0 || busyKey !== null} onClick={() => { const message = commitMessage.trim(); void mutate('commit', 'git.commit', { message }).then(ok => { if (ok) setCommitMessage('') }) }}>{busyKey === 'commit' ? '提交中…' : `提交${staged.length ? ` (${staged.length})` : ''}`}</button></div>
      </> : <HistoryList entries={history} selected={selected} onSelect={openDiff} />}</div>
      {selected && <DiffPane target={selected} diff={diff} loading={diffLoading} initialLayout={defaultLayout} onDetach={() => detach(selected)} onClose={() => { setSelected(null); setDiff(null) }} />}
    </div>}
    {discard && <ConfirmModal title="丢弃文件更改？" description={`“${discard.path}” 的未暂存更改将无法恢复。`} confirmLabel="丢弃更改" onCancel={() => setDiscard(null)} onConfirm={() => { const target = discard; setDiscard(null); void mutate(`discard:${target.path}`, 'git.discard', { path: target.path }) }} />}
  </section>
}

function ChangeGroup(props: { title: string; entries: GitStatusEntry[]; staged: boolean; busyKey: string | null; selected: DiffTarget | null; onSelect: (target: DiffTarget) => void; onToggle: (entry: GitStatusEntry) => void; onDiscard?: (entry: GitStatusEntry) => void; onOpenFile?: (path: string) => void }): JSX.Element {
  return <section><div style={s.groupHeader}><span>{props.title}</span><span style={s.groupCount}>{props.entries.length}</span></div>
    {props.entries.length === 0 ? <div style={s.groupEmpty}>没有更改</div> : props.entries.map(entry => {
      const active = props.selected?.kind === 'change' && props.selected.entry.path === entry.path && props.selected.staged === props.staged
      return <div key={`${props.staged ? 's' : 'u'}:${entry.path}`} style={active ? s.fileRowActive : s.fileRow}>
        <button type="button" style={s.fileMain} title={entry.path} onClick={() => props.onSelect({ kind: 'change', entry, staged: props.staged })}><StatusBadge entry={entry} /><span style={s.fileName}>{fileName(entry.path)}</span><span style={s.fileDir}>{dirName(entry.path)}</span></button>
        <div style={s.rowActions}>{props.onOpenFile && <button type="button" style={s.rowButton} title="打开文件" onClick={() => props.onOpenFile?.(entry.path)}>↗</button>}{props.onDiscard && entry.xy !== '??' && <button type="button" style={s.rowButtonDanger} title="丢弃更改" onClick={() => props.onDiscard?.(entry)}>↶</button>}<button type="button" style={s.rowButton} disabled={props.busyKey?.endsWith(entry.path)} title={props.staged ? '取消暂存' : '暂存'} onClick={() => props.onToggle(entry)}>{props.staged ? '−' : '+'}</button></div>
      </div>
    })}</section>
}

function HistoryList({ entries, selected, onSelect }: { entries: GitLogEntry[]; selected: DiffTarget | null; onSelect: (target: DiffTarget) => void }): JSX.Element {
  if (!entries.length) return <Empty title="暂无提交历史" detail="创建第一次提交后会显示在这里。" />
  return <div>{entries.map(entry => <button key={entry.hashFull} type="button" style={selected?.kind === 'commit' && selected.entry.hashFull === entry.hashFull ? s.historyRowActive : s.historyRow} onClick={() => onSelect({ kind: 'commit', entry })}>
    <span style={s.commitDot} /><span style={s.historyContent}><span style={s.historySubject}>{entry.subject}</span><span style={s.historyMeta}><code>{entry.hash}</code> · {entry.author} · {relativeDate(entry.date)}</span>{entry.refs && <span style={s.refs}>{entry.refs}</span>}</span>
  </button>)}</div>
}

function DiffPane({ target, diff, loading, initialLayout, onDetach, onClose }: { target: DiffTarget; diff: string | null; loading: boolean; initialLayout: DiffLayout; onDetach: () => void; onClose: () => void }): JSX.Element {
  const [layout, setLayout] = useState<DiffLayout>(initialLayout)
  const title = targetTitle(target)
  return <section style={s.diffPane}><header style={s.diffHeader}><span style={s.diffTitle} title={title}>{title}</span><div style={s.diffActions}><LayoutSwitch value={layout} onChange={setLayout} /><button type="button" style={s.rowButton} onClick={onDetach} aria-label="拉出为独立 Diff" title="拉出为独立 Diff">↗</button><button type="button" style={s.rowButton} onClick={onClose} aria-label="关闭 Diff">×</button></div></header>{loading ? <Centered label="正在生成 Diff…" /> : !diff ? <Empty title="没有可显示的差异" detail="文件可能为空，或更改已移动到另一个暂存区。" /> : <DiffContent content={diff} layout={layout} wrap={layout === 'split'} />}</section>
}

function DiffViewer({ content, path, store }: FileViewerProps): JSX.Element {
  const settings = usePluginSettings(store, DIFF_ID)
  const [layout, setLayout] = useState<DiffLayout>('unified')
  return <section style={s.shell}><header style={s.header}><div style={{ minWidth: 0 }}><div style={s.branch}>{fileName(path)}</div><div style={s.repo}>{path}</div></div><LayoutSwitch value={layout} onChange={setLayout} /></header><DiffContent content={content ?? ''} layout={layout} wrap={layout === 'split' || boolSetting(settings.wrapLines, false)} /></section>
}

function DetachedDiff({ scope, tab, store }: TabComponentProps): JSX.Element {
  const prefs = usePluginSettings(store, GIT_ID)
  const meta = tab.meta as DetachedDiffMeta | undefined
  const [layout, setLayout] = useState<DiffLayout>(prefs.diffLayout === 'split' ? 'split' : 'unified')
  const [diff, setDiff] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!meta?.target) return
    let cancelled = false
    const targetScope = meta.repoRoot ? { ...scope, repoRoot: meta.repoRoot } : scope
    setDiff(null); setError(null)
    void loadTargetDiff(meta.target, targetScope, meta.repoRoot ?? scope.cwd).then(value => { if (!cancelled) setDiff(value) }, reason => { if (!cancelled) setError(messageOf(reason)) })
    return () => { cancelled = true }
  }, [scope.sessionId, scope.cwd, meta?.repoRoot, meta?.target, tick])
  if (!meta?.target) return <Empty title="Diff 数据不可用" detail="请从 Git 变更或历史记录重新打开。" />
  return <section style={s.shell}><header style={s.header}><div style={{ minWidth: 0 }}><div style={s.branch}>{targetTitle(meta.target)}</div><div style={s.repo}>{meta.repoRoot ?? scope.cwd}</div></div><div style={s.diffActions}><LayoutSwitch value={layout} onChange={setLayout} /><button type="button" style={s.iconButton} title="刷新 Diff" onClick={() => setTick(value => value + 1)}>↻</button></div></header>{error ? <div style={s.error}>{error}</div> : diff === null ? <Centered label="正在生成 Diff…" /> : !diff ? <Empty title="没有可显示的差异" detail="内容可能已经改变。" /> : <DiffContent content={diff} layout={layout} wrap={layout === 'split'} />}</section>
}

type DiffLayout = 'unified' | 'split'
function LayoutSwitch({ value, onChange }: { value: DiffLayout; onChange: (value: DiffLayout) => void }): JSX.Element {
  return <div style={s.layoutSwitch} aria-label="Diff 布局"><button type="button" title="单栏" aria-pressed={value === 'unified'} style={value === 'unified' ? s.layoutButtonActive : s.layoutButton} onClick={() => onChange('unified')}>单</button><button type="button" title="双栏" aria-pressed={value === 'split'} style={value === 'split' ? s.layoutButtonActive : s.layoutButton} onClick={() => onChange('split')}>双</button></div>
}

function DiffContent({ content, layout, wrap }: { content: string; layout: DiffLayout; wrap: boolean }): JSX.Element {
  return layout === 'split' ? <SplitDiff content={content} wrap={wrap} /> : <DiffCode content={content} wrap={wrap} />
}

function DiffCode({ content, wrap }: { content: string; wrap: boolean }): JSX.Element {
  const lines = useMemo(() => content.split('\n'), [content])
  return <pre style={{ ...s.diffCode, whiteSpace: wrap ? 'pre-wrap' : 'pre' }}>{lines.map((line, index) => {
    const kind = line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'del' : line.startsWith('@@') ? 'hunk' : line.startsWith('diff ') ? 'file' : 'plain'
    return <div key={index} style={kind === 'add' ? s.diffAdd : kind === 'del' ? s.diffDel : kind === 'hunk' ? s.diffHunk : kind === 'file' ? s.diffFile : undefined}><span style={s.lineNo}>{index + 1}</span>{line || ' '}</div>
  })}</pre>
}

interface SplitRow { oldNo?: number; newNo?: number; oldText?: string; newText?: string; kind: 'plain' | 'change' | 'header' }
function SplitDiff({ content, wrap }: { content: string; wrap: boolean }): JSX.Element {
  const rows = useMemo(() => splitDiffRows(content), [content])
  return <div style={s.splitRoot}>
    <div style={s.splitLabels}><span>旧文件</span><span>新文件</span></div>
    <div style={s.splitScroll}>{rows.map((row, index) => row.kind === 'header'
      ? <div key={index} style={s.splitHeader}>{row.oldText}</div>
      : <div key={index} style={s.splitRow}>
        <SplitCell no={row.oldNo} text={row.oldText} tone={row.kind === 'change' && row.oldText !== undefined ? 'del' : 'plain'} wrap={wrap} />
        <SplitCell no={row.newNo} text={row.newText} tone={row.kind === 'change' && row.newText !== undefined ? 'add' : 'plain'} wrap={wrap} />
      </div>)}</div>
  </div>
}

function SplitCell({ no, text, tone, wrap }: { no?: number; text?: string; tone: 'plain' | 'add' | 'del'; wrap: boolean }): JSX.Element {
  return <div style={{ ...s.splitCell, ...(tone === 'add' ? s.diffAdd : tone === 'del' ? s.diffDel : undefined) }}><span style={s.splitNo}>{no ?? ''}</span><span style={{ ...s.splitText, whiteSpace: wrap ? 'pre-wrap' : 'pre', overflowWrap: wrap ? 'anywhere' : 'normal', wordBreak: wrap ? 'break-word' : 'normal' }}>{text ?? ''}</span></div>
}

function splitDiffRows(content: string): SplitRow[] {
  const result: SplitRow[] = []
  const lines = content.split('\n')
  let oldNo = 0, newNo = 0, index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) { oldNo = Number(hunk[1]); newNo = Number(hunk[2]); result.push({ kind: 'header', oldText: line }); index += 1; continue }
    if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('new file ') || line.startsWith('deleted file ')) { result.push({ kind: 'header', oldText: line }); index += 1; continue }
    if (line.startsWith('-')) {
      const removed: string[] = [], added: string[] = []
      while (index < lines.length && (lines[index] ?? '').startsWith('-') && !(lines[index] ?? '').startsWith('--- ')) { removed.push((lines[index] ?? '').slice(1)); index += 1 }
      while (index < lines.length && (lines[index] ?? '').startsWith('+') && !(lines[index] ?? '').startsWith('+++ ')) { added.push((lines[index] ?? '').slice(1)); index += 1 }
      const count = Math.max(removed.length, added.length)
      for (let at = 0; at < count; at += 1) result.push({ kind: 'change', oldNo: removed[at] === undefined ? undefined : oldNo++, newNo: added[at] === undefined ? undefined : newNo++, oldText: removed[at], newText: added[at] })
      continue
    }
    if (line.startsWith('+')) { result.push({ kind: 'change', newNo: newNo++, newText: line.slice(1) }); index += 1; continue }
    if (line.startsWith(' ')) { result.push({ kind: 'plain', oldNo: oldNo++, newNo: newNo++, oldText: line.slice(1), newText: line.slice(1) }); index += 1; continue }
    if (line === '\\ No newline at end of file') { result.push({ kind: 'header', oldText: line }); index += 1; continue }
    result.push({ kind: 'header', oldText: line }); index += 1
  }
  return result
}

function ConfirmModal(props: { title: string; description: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void }): JSX.Element {
  return <div style={s.modalBackdrop} onMouseDown={event => { if (event.currentTarget === event.target) props.onCancel() }}><div style={s.modal} role="alertdialog" aria-modal="true" aria-labelledby="git-confirm-title"><div style={s.modalIcon}>!</div><h3 id="git-confirm-title" style={s.modalTitle}>{props.title}</h3><p style={s.modalText}>{props.description}</p><div style={s.modalActions}><button type="button" style={s.secondaryButton} onClick={props.onCancel}>取消</button><button type="button" style={s.dangerButton} onClick={props.onConfirm}>{props.confirmLabel}</button></div></div></div>
}

function usePluginSettings(store: SidebarStore, id: string): Record<string, unknown> {
  return useSyncExternalStore(useCallback(listener => store.subscribe(listener), [store]), useCallback(() => store.getSnapshot().prefs.pluginSettings[id] ?? EMPTY_SETTINGS, [store, id]))
}

async function call<T = { ok: true }>(method: string, scope: SessionScope, extra: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`/sidebar/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: scope.sessionId, ...(scope.cwd ? { cwd: scope.cwd } : {}), ...(scope.repoRoot ? { repoRoot: scope.repoRoot } : {}), ...extra }) })
  const envelope = await response.json().catch(() => null) as { ok?: boolean; value?: T; error?: { message?: string } } | null
  if (!response.ok || envelope?.ok !== true || envelope.value === undefined) throw new Error(envelope?.error?.message ?? `HTTP ${response.status}`)
  return envelope.value
}

async function loadTargetDiff(target: DiffTarget, scope: SessionScope, root?: string): Promise<string> {
  if (target.kind === 'commit') return (await call<{ diff: string }>('git.commit-diff', scope, { hash: target.entry.hashFull })).diff
  const result = await call<{ diff: string }>('git.diff', scope, { path: target.entry.path, staged: target.staged })
  if (result.diff || target.entry.xy !== '??') return result.diff
  const file = await call<{ kind: string; content?: string }>('fs.read', scope, { path: joinPath(root ?? '', target.entry.path) })
  return file.kind === 'text' ? addedDiff(target.entry.path, file.content ?? '') : ''
}

const isStaged = (entry: GitStatusEntry): boolean => entry.xy[0] !== ' ' && entry.xy[0] !== '?'
const isUnstaged = (entry: GitStatusEntry): boolean => entry.xy === '??' || (entry.xy[1] !== ' ' && entry.xy[1] !== undefined)
const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason)
const fileName = (path: string): string => path.replace(/\\/g, '/').split('/').pop() || path
const dirName = (path: string): string => { const value = path.replace(/\\/g, '/'); const index = value.lastIndexOf('/'); return index < 0 ? '' : value.slice(0, index) }
const boolSetting = (value: unknown, fallback: boolean): boolean => typeof value === 'boolean' ? value : fallback
const numberSetting = (value: unknown, fallback: number, min: number, max: number): number => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
const joinPath = (root: string, path: string): string => `${root.replace(/[\\/]+$/, '')}${root.includes('\\') ? '\\' : '/'}${path.replace(/^[\\/]+/, '')}`
const addedDiff = (path: string, content: string): string => `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${content.split('\n').length} @@\n${content.split('\n').map(line => `+${line}`).join('\n')}`
const targetTitle = (target: DiffTarget): string => target.kind === 'change' ? fileName(target.entry.path) : `${target.entry.hash} ${target.entry.subject}`
const detachedId = (target: DiffTarget, root?: string): string => target.kind === 'change' ? `${DIFF_TAB_ID}:w:${encodeURIComponent(root ?? '')}:${target.staged ? 's' : 'u'}:${target.entry.path}` : `${DIFF_TAB_ID}:c:${target.entry.hashFull}`
const relativeDate = (value: string): string => { const time = Date.parse(value); if (!Number.isFinite(time)) return value; const days = Math.floor((Date.now() - time) / 86400000); return days < 1 ? '今天' : days < 30 ? `${days} 天前` : new Date(time).toLocaleDateString() }
function Count({ value }: { value: number }): JSX.Element | null { return value ? <span style={s.count}>{value > 99 ? '99+' : value}</span> : null }
function StatusBadge({ entry }: { entry: GitStatusEntry }): JSX.Element { const mark = entry.xy === '??' ? 'U' : entry.xy.includes('A') ? 'A' : entry.xy.includes('D') ? 'D' : entry.xy.includes('R') ? 'R' : 'M'; return <span style={{ ...s.statusBadge, color: mark === 'D' ? '#e35d6a' : mark === 'A' || mark === 'U' ? '#2d9d67' : '#d38b28' }}>{mark}</span> }
function Centered({ label }: { label: string }): JSX.Element { return <div style={s.centered}>{label}</div> }
function Empty({ title, detail }: { title: string; detail: string }): JSX.Element { return <div style={s.empty}><span style={s.emptyIcon}>⑂</span><strong>{title}</strong><span>{detail}</span></div> }

const fg = 'var(--dsw-alias-label-primary, #17233c)', muted = 'var(--dsw-alias-label-secondary, #6f7f9b)', border = 'var(--dsw-alias-border-l3, rgba(118,137,166,.22))', layer = 'var(--dsw-alias-container-bg, #fff)', hover = 'var(--dsw-alias-container-bg-hover, rgba(93,130,190,.09))', accent = 'var(--dsw-alias-brand-primary, #ed67ad)'
const s: Record<string, React.CSSProperties> = {
  shell: { position: 'relative', boxSizing: 'border-box', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', color: fg, background: layer, fontSize: 12 }, header: { flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 12px 9px', borderBottom: `1px solid ${border}` },
  branch: { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, fontSize: 13, fontWeight: 650 }, branchMark: { color: accent, fontSize: 16 }, repo: { marginTop: 3, color: muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10.5 }, iconButton: { width: 29, height: 29, border: `1px solid ${border}`, borderRadius: 8, color: fg, background: 'transparent', cursor: 'pointer', fontSize: 17 },
  tabs: { display: 'flex', flex: '0 0 auto', height: 36, padding: '0 10px', gap: 15, borderBottom: `1px solid ${border}` }, tab: { border: 0, padding: '0 2px', color: muted, background: 'transparent', cursor: 'pointer', fontSize: 12 }, tabActive: { border: 0, borderBottom: `2px solid ${accent}`, padding: '0 2px', color: fg, background: 'transparent', cursor: 'pointer', fontWeight: 650, fontSize: 12 }, count: { marginLeft: 4, padding: '1px 5px', borderRadius: 999, color: muted, background: hover, fontSize: 10 },
  body: { minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }, listPane: { minHeight: 130, flex: '1 1 52%', overflow: 'auto' }, groupHeader: { position: 'sticky', top: 0, zIndex: 1, display: 'flex', gap: 6, padding: '8px 12px 5px', color: muted, background: layer, fontSize: 10.5, fontWeight: 650, textTransform: 'uppercase' }, groupCount: { fontWeight: 500, opacity: .72 }, groupEmpty: { padding: '7px 12px 9px', color: muted, opacity: .75 },
  fileRow: { display: 'flex', alignItems: 'center', minHeight: 31, padding: '0 5px 0 8px' }, fileRowActive: { display: 'flex', alignItems: 'center', minHeight: 31, padding: '0 5px 0 8px', background: hover, boxShadow: `inset 2px 0 ${accent}` }, fileMain: { minWidth: 0, flex: 1, display: 'flex', alignItems: 'baseline', gap: 6, padding: '6px 3px', border: 0, color: fg, background: 'transparent', cursor: 'pointer', textAlign: 'left' }, statusBadge: { width: 13, flex: '0 0 auto', fontWeight: 750, fontSize: 10 }, fileName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, fileDir: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: muted, fontSize: 9.5 }, rowActions: { display: 'flex' }, rowButton: { width: 25, height: 25, padding: 0, border: 0, borderRadius: 6, color: muted, background: 'transparent', cursor: 'pointer', fontSize: 14 }, rowButtonDanger: { width: 25, height: 25, padding: 0, border: 0, borderRadius: 6, color: '#d85c67', background: 'transparent', cursor: 'pointer', fontSize: 14 },
  commitBox: { display: 'flex', flexDirection: 'column', gap: 7, padding: 10, marginTop: 5, borderTop: `1px solid ${border}` }, commitInput: { boxSizing: 'border-box', width: '100%', resize: 'vertical', minHeight: 48, padding: '8px 9px', border: `1px solid ${border}`, borderRadius: 8, color: fg, background: layer, font: 'inherit' }, primaryButton: { minHeight: 30, border: 0, borderRadius: 8, color: '#fff', background: accent, cursor: 'pointer', fontWeight: 650 }, secondaryButton: { minHeight: 32, padding: '0 14px', border: `1px solid ${border}`, borderRadius: 8, color: fg, background: layer, cursor: 'pointer' }, dangerButton: { minHeight: 32, padding: '0 14px', border: 0, borderRadius: 8, color: '#fff', background: '#d94d5c', cursor: 'pointer', fontWeight: 650 },
  historyRow: { boxSizing: 'border-box', width: '100%', display: 'flex', gap: 9, padding: '9px 11px', border: 0, borderBottom: `1px solid ${border}`, color: fg, background: 'transparent', textAlign: 'left', cursor: 'pointer' }, historyRowActive: { boxSizing: 'border-box', width: '100%', display: 'flex', gap: 9, padding: '9px 11px', border: 0, borderBottom: `1px solid ${border}`, color: fg, background: hover, textAlign: 'left', cursor: 'pointer' }, commitDot: { width: 7, height: 7, marginTop: 5, flex: '0 0 auto', border: `2px solid ${accent}`, borderRadius: 99, background: layer }, historyContent: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }, historySubject: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }, historyMeta: { color: muted, fontSize: 9.5 }, refs: { alignSelf: 'flex-start', padding: '1px 5px', borderRadius: 4, color: accent, background: hover, fontSize: 9 },
  diffPane: { minHeight: 165, flex: '1 1 48%', display: 'flex', flexDirection: 'column', borderTop: `1px solid ${border}`, background: '#fbfcfe', overflow: 'hidden' }, diffHeader: { height: 34, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '0 8px 0 11px', borderBottom: `1px solid ${border}` }, diffTitle: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }, diffActions: { display: 'flex', alignItems: 'center', gap: 4, flex: '0 0 auto' }, layoutSwitch: { display: 'flex', padding: 2, border: `1px solid ${border}`, borderRadius: 7, background: 'rgba(100,120,150,.06)' }, layoutButton: { width: 25, height: 22, padding: 0, border: 0, borderRadius: 5, color: muted, background: 'transparent', cursor: 'pointer', fontSize: 10 }, layoutButtonActive: { width: 25, height: 22, padding: 0, border: 0, borderRadius: 5, color: fg, background: layer, boxShadow: '0 1px 4px rgba(20,35,60,.14)', cursor: 'pointer', fontSize: 10, fontWeight: 700 }, diffCode: { boxSizing: 'border-box', flex: 1, minHeight: 0, margin: 0, padding: '7px 0 18px', overflow: 'auto', color: '#43506a', background: '#fbfcfe', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 10.5, lineHeight: 1.55, tabSize: 2 }, lineNo: { display: 'inline-block', width: 34, marginRight: 8, paddingRight: 7, color: '#9aa7bb', borderRight: '1px solid rgba(130,145,170,.18)', textAlign: 'right', userSelect: 'none' }, diffAdd: { color: '#17663c', background: 'rgba(46,160,91,.12)' }, diffDel: { color: '#973b46', background: 'rgba(225,82,98,.11)' }, diffHunk: { color: '#4f6faf', background: 'rgba(86,122,190,.1)' }, diffFile: { color: fg, fontWeight: 700, background: 'rgba(91,112,148,.08)' }, splitRoot: { minWidth: 0, minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fbfcfe', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 10.5 }, splitLabels: { display: 'grid', gridTemplateColumns: '1fr 1fr', flex: '0 0 auto', color: muted, background: 'rgba(100,120,150,.06)', borderBottom: `1px solid ${border}`, fontSize: 9.5, fontWeight: 700, textAlign: 'center', padding: '4px 0' }, splitScroll: { minWidth: 0, minHeight: 0, flex: 1, overflow: 'auto' }, splitRow: { width: '100%', minWidth: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }, splitCell: { minWidth: 0, minHeight: 17, display: 'grid', gridTemplateColumns: '34px minmax(0, 1fr)', overflow: 'hidden', color: '#43506a', borderRight: '1px solid rgba(130,145,170,.18)', lineHeight: 1.55 }, splitNo: { paddingRight: 7, marginRight: 8, color: '#9aa7bb', borderRight: '1px solid rgba(130,145,170,.18)', textAlign: 'right', userSelect: 'none' }, splitText: { minWidth: 0, display: 'block' }, splitHeader: { position: 'sticky', left: 0, maxWidth: '100%', padding: '3px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#4f6faf', background: 'rgba(86,122,190,.1)', fontWeight: 650 },
  centered: { margin: 'auto', padding: 20, color: muted, textAlign: 'center' }, empty: { margin: 'auto', maxWidth: 270, padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: muted, textAlign: 'center', lineHeight: 1.55 }, emptyIcon: { marginBottom: 3, color: accent, fontSize: 24 }, notice: { margin: 8, padding: 8, borderRadius: 7, color: '#8b671b', background: '#fff7df' }, error: { display: 'flex', justifyContent: 'space-between', gap: 8, padding: '7px 10px', color: '#a33b47', background: 'rgba(225,82,98,.1)', borderBottom: `1px solid ${border}` }, errorClose: { border: 0, color: 'inherit', background: 'transparent', cursor: 'pointer' },
  modalBackdrop: { position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', placeItems: 'center', padding: 18, background: 'rgba(18,27,43,.38)', backdropFilter: 'blur(3px)' }, modal: { boxSizing: 'border-box', width: 'min(390px, 100%)', padding: 22, border: `1px solid ${border}`, borderRadius: 16, color: fg, background: layer, boxShadow: '0 18px 60px rgba(15,25,43,.24)', textAlign: 'center' }, modalIcon: { display: 'grid', placeItems: 'center', width: 38, height: 38, margin: '0 auto 12px', borderRadius: 99, color: '#d94d5c', background: 'rgba(217,77,92,.12)', fontSize: 20, fontWeight: 800 }, modalTitle: { margin: 0, fontSize: 16 }, modalText: { margin: '8px 0 20px', color: muted, lineHeight: 1.55 }, modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
}
