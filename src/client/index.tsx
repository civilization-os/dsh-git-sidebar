/** Browser entry for the Git sidebar and unified-diff viewer. */
import type { Context } from '@deepseek-ai/cordis'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
export const inject = ['slots', 'sidebarRightTabs']

export interface SessionScope {
  sessionId?: string
  cwd?: string
  repoRoot?: string
}

export interface GitSidebarProps {
  scope: SessionScope
  store?: any
  visible?: boolean
  onOpenFile?: (path: string) => void
  onOpenDiff?: (target: any) => void
}

const GIT_ID = 'dsh-git-sidebar:git'
const DIFF_ID = 'dsh-git-sidebar:diff'
const DIFF_TAB_ID = 'dsh-git-sidebar:diff-view'
const EMPTY_SETTINGS: Record<string, unknown> = Object.freeze({})
const DIFF_PAGE_SIZE = 400
const MAX_DIFF_FILES = 100

interface GitStatusEntry { path: string; xy: string }
interface GitStatusResult { isRepo: boolean; branch?: string; entries: GitStatusEntry[]; truncated?: boolean; root?: string }
interface GitLogEntry { hash: string; hashFull: string; subject: string; author: string; date: string; refs: string }
interface GitBranchResult { current: string; names: string[] }
export interface GitSyncStatus { hasRemote: boolean; upstream?: string; ahead: number; behind: number }
export interface GitStashEntry { index: number; message: string; date: string }
type DiffTarget = { kind: 'change'; entry: GitStatusEntry; staged: boolean } | { kind: 'commit'; entry: GitLogEntry }
interface DetachedDiffMeta { target: DiffTarget; repoRoot?: string }

interface ParsedDiffFile {
  path: string
  additions: number
  deletions: number
  lines: string[]
}

/* ── Inline SVG Icons (100% aligned with DSH design system) ── */
function IconBranch({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path fillRule="evenodd" d="M11.75 2.5a1.75 1.75 0 10-2.45 1.608v3.454a2.25 2.25 0 01-1.2 1.986l-.85.454v-3.41a1.75 1.75 0 10-1.5 0v5.816a1.75 1.75 0 101.5 0v-.468l.944-.504a3.75 3.75 0 002-3.328V4.108a1.75 1.75 0 001.556-1.608zM5.75 4a.75.75 0 110-1.5.75.75 0 010 1.5zm0 9.5a.75.75 0 110-1.5.75.75 0 010 1.5zm5.25-10a.75.75 0 110-1.5.75.75 0 010 1.5z" />
    </svg>
  )
}

function IconRefresh({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path fillRule="evenodd" d="M8 2.5a5.5 5.5 0 105.006 3.238.75.75 0 011.378-.592A7 7 0 118 1v1.5a.75.75 0 01-1.28.53L4.47 1.28a.75.75 0 010-1.06l2.25-1.75A.75.75 0 018-.75V1a7 7 0 010 1.5z" />
    </svg>
  )
}

function IconPlus({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 2z" />
    </svg>
  )
}

function IconMinus({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M3.25 8a.75.75 0 01.75-.75h8a.75.75 0 010 1.5H4A.75.75 0 013.25 8z" />
    </svg>
  )
}

function IconUndo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path fillRule="evenodd" d="M7.78 2.22a.75.75 0 010 1.06L5.56 5.5h5.19a4.25 4.25 0 014.25 4.25v2.5a.75.75 0 01-1.5 0v-2.5a2.75 2.75 0 00-2.75-2.75H5.56l2.22 2.22a.75.75 0 11-1.06 1.06l-3.5-3.5a.75.75 0 010-1.06l3.5-3.5a.75.75 0 011.06 0z" />
    </svg>
  )
}

function IconOpenExternal({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M10.5 2.75a.75.75 0 01.75-.75h3a.75.75 0 01.75.75v3a.75.75 0 01-1.5 0V3.81l-4.72 4.72a.75.75 0 11-1.06-1.06L12.19 3.5H11.25a.75.75 0 01-.75-.75z" />
      <path d="M2.5 4.5A1.5 1.5 0 014 3h3.25a.75.75 0 010 1.5H4a.5.5 0 00-.5.5v8a.5.5 0 00.5.5h8a.5.5 0 00.5-.5V9.75a.75.75 0 011.5 0V12a1.5 1.5 0 01-1.5 1.5H4A1.5 1.5 0 012.5 12V4.5z" />
    </svg>
  )
}

function IconClose({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
    </svg>
  )
}

function IconCheck({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path fillRule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
    </svg>
  )
}

function IconDiffUnified({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <line x1="4" y1="5.5" x2="12" y2="5.5" stroke="currentColor" strokeWidth="1.2" />
      <line x1="4" y1="8" x2="12" y2="8" stroke="currentColor" strokeWidth="1.2" />
      <line x1="4" y1="10.5" x2="9" y2="10.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function IconDiffSplit({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" strokeWidth="1.2" />
      <line x1="3.5" y1="5.5" x2="6.5" y2="5.5" stroke="currentColor" strokeWidth="1" />
      <line x1="9.5" y1="5.5" x2="12.5" y2="5.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

function IconCopy({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z" />
      <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z" />
    </svg>
  )
}

function IconSync({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path fillRule="evenodd" d="M1.705 8.005a.75.75 0 01.834.656 5.5 5.5 0 009.592 2.97l-1.204-1.204a.25.25 0 01.177-.427h3.646a.25.25 0 01.25.25v3.646a.25.25 0 01-.427.177l-1.38-1.38A7 7 0 011.05 8.84a.75.75 0 01.655-.835zm12.59-1.01a.75.75 0 01-.834-.656 5.5 5.5 0 00-9.592-2.97l1.204 1.204a.25.25 0 01-.177.427H1.25a.25.25 0 01-.25-.25V1.104a.25.25 0 01.427-.177l1.38 1.38A7 7 0 0114.95 7.16a.75.75 0 01-.655.835z" />
    </svg>
  )
}

function IconTree({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path fillRule="evenodd" d="M1 2.75A.75.75 0 011.75 2h4.5a.75.75 0 01.75.75v1.5A.75.75 0 016.25 5h-2.5v3h4.5A.75.75 0 019 8.75v1.5a.75.75 0 01-.75.75h-4.5v2.25h4.5a.75.75 0 01.75.75v1.5a.75.75 0 01-.75.75h-4.5A.75.75 0 013 15.5V5H1.75A.75.75 0 011 4.25v-1.5z" />
    </svg>
  )
}

function IconList({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path fillRule="evenodd" d="M2.5 12a1 1 0 100-2 1 1 0 000 2zm0-4a1 1 0 100-2 1 1 0 000 2zm0-4a1 1 0 100-2 1 1 0 000 2zm3.25.75a.75.75 0 01.75-.75h7.5a.75.75 0 010 1.5h-7.5a.75.75 0 01-.75-.75zm0 4a.75.75 0 01.75-.75h7.5a.75.75 0 010 1.5h-7.5a.75.75 0 01-.75-.75zm0 4a.75.75 0 01.75-.75h7.5a.75.75 0 010 1.5h-7.5a.75.75 0 01-.75-.75z" />
    </svg>
  )
}

function IconFolder({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M1.75 1A1.75 1.75 0 000 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0016 13.25v-8.5A1.75 1.75 0 0014.25 3H7.5a.25.25 0 01-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75z" />
    </svg>
  )
}

function IconArchive({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path d="M0 2a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1v7.5a2.5 2.5 0 01-2.5 2.5h-9A2.5 2.5 0 011 13.5V5a1 1 0 01-1-1V2zm2 3v8.5a1 1 0 001 1h9a1 1 0 001-1V5H2zm4 2.5a.75.75 0 01.75-.75h2.5a.75.75 0 010 1.5h-2.5a.75.75 0 01-.75-.75zM1.5 2.5v1h13v-1h-13z" />
    </svg>
  )
}

function IconDownload({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path fillRule="evenodd" d="M7.47 10.78a.75.75 0 001.06 0l3.75-3.75a.75.75 0 00-1.06-1.06L8.75 8.44V1.75a.75.75 0 00-1.5 0v6.69L4.78 5.97a.75.75 0 00-1.06 1.06l3.75 3.75zM3.75 13a.75.75 0 000 1.5h8.5a.75.75 0 000-1.5h-8.5z" />
    </svg>
  )
}

function IconUpload({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      <path fillRule="evenodd" d="M8.53 1.22a.75.75 0 00-1.06 0L3.72 4.97a.75.75 0 001.06 1.06l2.47-2.47v6.69a.75.75 0 001.5 0V3.56l2.47 2.47a.75.75 0 001.06-1.06L8.53 1.22zM3.75 13a.75.75 0 000 1.5h8.5a.75.75 0 000-1.5h-8.5z" />
    </svg>
  )
}

const OFFICIAL_GIT_TAB_ID = '@civilization/dsh-git-sidebar'
const OFFICIAL_DIFF_TAB_ID = '@civilization/dsh-git-sidebar:diff'
const GIT_DIFF_SCHEME = 'dsh-resource://git-diff/'

function GitGlyphIcon({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <IconBranch size={size} />
    </span>
  )
}

function OfficialGitTabTitle({ useTabInfo }: any): JSX.Element {
  const info = useTabInfo ? useTabInfo() : null
  const title = info?.tab?.title || 'Git'
  return (
    <>
      <IconBranch size={15} />
      <span>{title}</span>
    </>
  )
}

function OfficialGitTabBody(props: any): JSX.Element {
  const { sessionId, useSessions, useTabInfo } = props
  const tabInfo = useTabInfo ? useTabInfo() : null
  const tabActions = tabInfo?.tab?.actions

  const sessionCwd = useSessions ? useSessions((sessions: any) => sessions?.byId?.[sessionId]?.cwd) : undefined
  const scope = useMemo<SessionScope>(() => ({
    sessionId: sessionId || 'default',
    cwd: sessionCwd,
  }), [sessionId, sessionCwd])

  // 在官方右侧栏打开专属独立 Diff 标签页
  const handleOpenDiff = useCallback((target: DiffTarget) => {
    if (tabActions?.openResource) {
      const title = targetTitle(target)
      const uri = `${GIT_DIFF_SCHEME}${encodeURIComponent(title)}?target=${encodeURIComponent(JSON.stringify(target))}`
      tabActions.openResource(uri)
    }
  }, [tabActions])

  // 在官方编辑器/文件预览中打开文件
  const handleOpenFile = useCallback((filePath: string) => {
    if (tabActions?.openResource && sessionId) {
      const normalized = filePath.replace(/\\/g, '/').replace(/^\.?\//, '')
      tabActions.openResource(`dsh-resource://file/session/${encodeURIComponent(sessionId)}/${encodeURIComponent(normalized)}`)
    }
  }, [tabActions, sessionId])

  return (
    <GitSidebar
      scope={scope}
      visible={true}
      onOpenDiff={handleOpenDiff}
      onOpenFile={handleOpenFile}
    />
  )
}

function OfficialGitDiffTabTitle({ useTabInfo }: any): JSX.Element {
  const info = useTabInfo ? useTabInfo() : null
  const title = info?.tab?.title || 'Diff'
  return (
    <>
      <span style={{ fontWeight: 'bold', fontSize: 13, marginRight: 5, opacity: 0.85 }}>±</span>
      <span>{title}</span>
    </>
  )
}

function OfficialGitDiffTabBody(props: any): JSX.Element {
  const { useTabInfo, sessionId, useSessions } = props
  const tabInfo = useTabInfo ? useTabInfo() : null
  const address = tabInfo?.tab?.navigation?.address || ''
  const sessionCwd = useSessions ? useSessions((sessions: any) => sessions?.byId?.[sessionId]?.cwd) : undefined

  const target = useMemo<DiffTarget | null>(() => {
    try {
      const qIdx = address.indexOf('?target=')
      if (qIdx === -1) return null
      const raw = address.slice(qIdx + 8)
      return JSON.parse(decodeURIComponent(raw))
    } catch {
      return null
    }
  }, [address])

  const [diff, setDiff] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [layout, setLayout] = useState<DiffLayout>('unified')

  const repoScope: SessionScope = useMemo(() => ({
    sessionId: sessionId || 'default',
    cwd: sessionCwd,
  }), [sessionId, sessionCwd])

  useEffect(() => {
    if (!target) return
    setLoading(true)
    setError(null)
    void loadTargetDiff(target, repoScope, sessionCwd)
      .then(setDiff)
      .catch(err => {
        setError(messageOf(err))
        setDiff(null)
      })
      .finally(() => setLoading(false))
  }, [target, repoScope, sessionCwd])

  const title = target ? targetTitle(target) : 'Diff'

  return (
    <div className="dsh-git-root">
      <GlobalDshStyle />
      <header className="dsh-git-header">
        <div className="dsh-git-header-info">
          <div className="dsh-git-branch-row">
            <span style={{ fontWeight: 'bold', fontSize: 13, color: 'var(--dsw-alias-brand-primary)' }}>±</span>
            <span className="dsh-git-branch-name">{title}</span>
          </div>
          <div className="dsh-git-repo-path">{sessionCwd || ''}</div>
        </div>
        <LayoutSwitch value={layout} onChange={setLayout} />
      </header>
      {loading ? (
        <Centered label="Loading..." />
      ) : error ? (
        <div className="dsh-git-banner-error">{error}</div>
      ) : !diff ? (
        <Empty title="没有差异变更" detail="目标文件与对应版本一致。" />
      ) : (
        <DiffContent content={diff} layout={layout} wrap={layout === 'split'} />
      )}
    </div>
  )
}

export function apply(ctx: Context): void {
  const sidebarRightTabs = (ctx as any).sidebarRightTabs
  const slots = (ctx as any).slots

  // DSH 0.1.5-rc.2 官方右侧栏原生注册
  if (sidebarRightTabs && slots) {
    // 1. 注册 Git 主面板
    ctx.effect(() => sidebarRightTabs.register({
      id: OFFICIAL_GIT_TAB_ID,
      kind: 'git',
      priority: 'extension',
      title: () => 'Git',
      guide: [{
        order: 20,
        title: () => 'Git',
        description: () => '查看 Git 状态、暂存变更与提交历史',
        icon: GitGlyphIcon,
      }],
    }), 'dsh-git-sidebar: official tab definition')

    ctx.effect(() => slots.inject('sidebar.right.pane.tab', () => slots.register({
      name: 'sidebar.right.pane.tab',
      key: OFFICIAL_GIT_TAB_ID,
    }, OfficialGitTabBody)), 'dsh-git-sidebar: official tab body')

    ctx.effect(() => slots.inject('sidebar.right.pane.tab.title', () => slots.register({
      name: 'sidebar.right.pane.tab.title',
      key: OFFICIAL_GIT_TAB_ID,
    }, OfficialGitTabTitle)), 'dsh-git-sidebar: official tab title')

    // 2. 注册 Git 独立 Diff 标签页 (识别 dsh-resource://git-diff/** 地址)
    ctx.effect(() => sidebarRightTabs.register({
      id: OFFICIAL_DIFF_TAB_ID,
      kind: 'git-diff',
      patterns: ['dsh-resource://git-diff/**'],
      priority: 'extension',
      title: (address: string) => {
        try {
          const pathPart = address.replace(GIT_DIFF_SCHEME, '').split('?')[0]
          return pathPart ? decodeURIComponent(pathPart) : 'Diff'
        } catch {
          return 'Diff'
        }
      },
    }), 'dsh-git-sidebar: official diff tab definition')

    ctx.effect(() => slots.inject('sidebar.right.pane.tab', () => slots.register({
      name: 'sidebar.right.pane.tab',
      key: OFFICIAL_DIFF_TAB_ID,
    }, OfficialGitDiffTabBody)), 'dsh-git-sidebar: official diff tab body')

    ctx.effect(() => slots.inject('sidebar.right.pane.tab.title', () => slots.register({
      name: 'sidebar.right.pane.tab.title',
      key: OFFICIAL_DIFF_TAB_ID,
    }, OfficialGitDiffTabTitle)), 'dsh-git-sidebar: official diff tab title')
  }
}

/* ── Main Git Sidebar Component ── */
function GitSidebar({ scope, store, visible = true, onOpenFile, onOpenDiff }: GitSidebarProps): JSX.Element {
  const prefs = usePluginSettings(store, GIT_ID)
  const autoRefresh = !boolSetting(prefs.pauseAutoRefresh, false)
  const showUntracked = !boolSetting(prefs.hideUntracked, false)
  const refreshSeconds = numberSetting(prefs.refreshSeconds, 5, 2, 60)
  const historyLimit = numberSetting(prefs.historyLimit, 20, 5, 100)
  const defaultLayout = prefs.diffLayout === 'split' ? 'split' : 'unified'
  const openMode = prefs.openMode === 'detached' ? 'detached' : 'preview'

  const [status, setStatus] = useState<GitStatusResult | null>(null)
  const [history, setHistory] = useState<GitLogEntry[]>([])
  const [branches, setBranches] = useState<string[]>([])
  const [mode, setMode] = useState<'changes' | 'history'>('changes')
  const [selected, setSelected] = useState<DiffTarget | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [diffLoading, setDiffLoading] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [discard, setDiscard] = useState<GitStatusEntry | null>(null)
  const [discardAllPrompt, setDiscardAllPrompt] = useState(false)
  const [showBranchSelect, setShowBranchSelect] = useState(false)
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false)
  const [hasMoreHistory, setHasMoreHistory] = useState(true)

  // 增强功能状态
  const [viewMode, setViewMode] = useState<'flat' | 'tree'>('tree')
  const [sync, setSync] = useState<GitSyncStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [showSyncMenu, setShowSyncMenu] = useState(false)
  const [stashes, setStashes] = useState<GitStashEntry[]>([])
  const [showStashMenu, setShowStashMenu] = useState(false)
  const [showStashModal, setShowStashModal] = useState(false)
  const [stashMsg, setStashMsg] = useState('')
  const [newBranch, setNewBranch] = useState('')
  const [creatingBranch, setCreatingBranch] = useState(false)

  const request = useRef(0)
  const repoScope = useMemo<SessionScope>(
    () => (status?.root ? { ...scope, repoRoot: status.root } : scope),
    [scope, status?.root],
  )

  const handleLoadMoreHistory = async () => {
    if (loadingMoreHistory || !status?.root) return
    setLoadingMoreHistory(true)
    try {
      const nextBatch = await call<GitLogEntry[]>('git.log', repoScope, { count: 20, skip: history.length })
      if (nextBatch.length === 0 || nextBatch.length < 20) {
        setHasMoreHistory(false)
      }
      setHistory(prev => {
        const existingHashes = new Set(prev.map(p => p.hashFull))
        const filtered = nextBatch.filter(item => !existingHashes.has(item.hashFull))
        return [...prev, ...filtered]
      })
    } catch {
      setHasMoreHistory(false)
    } finally {
      setLoadingMoreHistory(false)
    }
  }

  const refresh = useCallback(async (quiet = false) => {
    const current = ++request.current
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const nextStatus = await call<GitStatusResult>('git.status', scope)
      const nextScope = nextStatus.root ? { ...scope, repoRoot: nextStatus.root } : scope

      const [nextHistory, branchResult, nextSync, nextStashes] = nextStatus.isRepo
        ? await Promise.all([
            call<GitLogEntry[]>('git.log', nextScope, { count: historyLimit, skip: 0 }).catch(() => []),
            call<GitBranchResult>('git.branch', nextScope).catch(() => ({ current: '', names: [] as string[] })),
            call<GitSyncStatus>('git.sync-status', nextScope).catch(() => null),
            call<GitStashEntry[]>('git.stash-list', nextScope).catch(() => []),
          ])
        : [[], { current: '', names: [] as string[] }, null, []]

      if (current !== request.current) return
      setStatus(nextStatus)
      setHistory(nextHistory)
      setHasMoreHistory(nextHistory.length >= historyLimit)
      setBranches(branchResult.names)
      setSync(nextSync)
      setStashes(nextStashes)
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
    onOpenDiff(target)
  }, [onOpenDiff])

  const openDiff = useCallback(async (target: DiffTarget) => {
    if (openMode === 'detached' && onOpenDiff) {
      detach(target)
      return
    }
    setSelected(target)
    setDiffLoading(true)
    setError(null)
    try {
      setDiff(await loadTargetDiff(target, repoScope, status?.root ?? scope.cwd))
    } catch (reason) {
      setError(messageOf(reason))
      setDiff(null)
    } finally {
      setDiffLoading(false)
    }
  }, [repoScope, scope.cwd, status?.root, openMode, onOpenDiff, detach])

  const mutate = async (key: string, method: string, payload: Record<string, unknown>): Promise<boolean> => {
    setBusyKey(key)
    setError(null)
    try {
      await call(method, repoScope, payload)
      if (key.startsWith('discard') || key.startsWith('unstage') || key.startsWith('stage') || key.startsWith('checkout')) {
        setSelected(null)
        setDiff(null)
      }
      await refresh(true)
      return true
    } catch (reason) {
      setError(messageOf(reason))
      return false
    } finally {
      setBusyKey(null)
    }
  }

  const handleCheckout = (branch: string) => {
    setShowBranchSelect(false)
    if (branch === status?.branch) return
    void mutate(`checkout:${branch}`, 'git.checkout', { branch })
  }

  const handleCreateBranch = async () => {
    const name = newBranch.trim()
    if (!name) return
    setCreatingBranch(true)
    setError(null)
    try {
      await call('git.create-branch', repoScope, { branch: name })
      setNewBranch('')
      setShowBranchSelect(false)
      await refresh(true)
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setCreatingBranch(false)
    }
  }

  const handleCommit = () => {
    const message = commitMessage.trim()
    if (!message || staged.length === 0 || busyKey !== null) return
    void mutate('commit', 'git.commit', { message }).then(ok => {
      if (ok) setCommitMessage('')
    })
  }

  const handleSyncAction = async (action: 'fetch' | 'pull' | 'push' | 'sync') => {
    setShowSyncMenu(false)
    setSyncing(true)
    setError(null)
    try {
      if (action === 'fetch') {
        await call('git.fetch', repoScope)
      } else if (action === 'pull') {
        await call('git.pull', repoScope)
      } else if (action === 'push') {
        await call('git.push', repoScope)
      } else if (action === 'sync') {
        if ((sync?.behind ?? 0) > 0) {
          await call('git.pull', repoScope)
        }
        await call('git.push', repoScope)
      }
      await refresh(true)
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setSyncing(false)
    }
  }

  const handleStash = async () => {
    setShowStashModal(false)
    setError(null)
    try {
      await call('git.stash', repoScope, { message: stashMsg.trim() || undefined })
      setStashMsg('')
      setSelected(null)
      setDiff(null)
      await refresh(true)
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  const handleStashPop = async (index?: number) => {
    setShowStashMenu(false)
    setError(null)
    try {
      await call('git.stash-pop', repoScope, index !== undefined ? { index } : {})
      await refresh(true)
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  const handleApplyHunk = useCallback(async (patch: string, reverse: boolean) => {
    setError(null)
    try {
      await call('git.apply-patch', repoScope, { patch, reverse })
      await refresh(true)
      if (selected && selected.kind === 'change') {
        setDiff(await loadTargetDiff(selected, repoScope, status?.root ?? scope.cwd))
      }
    } catch (reason) {
      setError(messageOf(reason))
    }
  }, [repoScope, selected, status?.root, scope.cwd, refresh])

  const staged = (status?.entries ?? []).filter(isStaged)
  const unstaged = (status?.entries ?? []).filter(entry => isUnstaged(entry) && (showUntracked || entry.xy !== '??'))

  if (loading && status === null) {
    return (
      <div className="dsh-git-root">
        <GlobalDshStyle />
        <Centered label="Loading..." />
      </div>
    )
  }

  return (
    <div className="dsh-git-root">
      <GlobalDshStyle />
      {/* Header */}
      <header className="dsh-git-header">
        <div className="dsh-git-header-info">
          <div className="dsh-git-branch-row">
            <span className="dsh-git-branch-icon"><IconBranch size={15} /></span>
            <div className="dsh-git-branch-select-wrap">
              <button
                type="button"
                className="dsh-git-branch-trigger"
                onClick={() => setShowBranchSelect(!showBranchSelect)}
                title="切换或新建分支"
              >
                <span className="dsh-git-branch-name">{status?.branch ?? 'Git'}</span>
                <span style={{ opacity: 0.6, fontSize: 10 }}>▾</span>
              </button>
              {showBranchSelect && (
                <div className="dsh-git-branch-dropdown">
                  <div className="dsh-git-branch-create-box">
                    <input
                      type="text"
                      className="dsh-git-input-sm"
                      placeholder="新建并检出分支…"
                      value={newBranch}
                      onChange={e => setNewBranch(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void handleCreateBranch()
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="dsh-git-btn-sm"
                      disabled={!newBranch.trim() || creatingBranch}
                      onClick={() => void handleCreateBranch()}
                      title="基于当前提交创建并检出新分支"
                    >
                      {creatingBranch ? '…' : '+ 创建'}
                    </button>
                  </div>
                  <div className="dsh-git-branch-list">
                    {branches.map(b => (
                      <button
                        key={b}
                        type="button"
                        className="dsh-git-branch-item"
                        data-active={b === status?.branch ? 'true' : undefined}
                        onClick={() => handleCheckout(b)}
                      >
                        {b === status?.branch && <IconCheck size={12} />}
                        <span>{b}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Sync Status Badge */}
            {status?.isRepo && sync && (
              <span
                className="dsh-git-sync-badge"
                title={
                  sync.upstream
                    ? `上游: ${sync.upstream} (领先 ${sync.ahead} / 落后 ${sync.behind})`
                    : '当前分支未关联远程分支'
                }
              >
                {sync.upstream ? (
                  <>
                    {sync.ahead > 0 && <span className="dsh-git-sync-ahead">↑{sync.ahead}</span>}
                    {sync.behind > 0 && <span className="dsh-git-sync-behind">↓{sync.behind}</span>}
                    {sync.ahead === 0 && sync.behind === 0 && <span className="dsh-git-sync-even">✓</span>}
                  </>
                ) : (
                  <span className="dsh-git-sync-no-upstream">无上游</span>
                )}
              </span>
            )}
          </div>
          <div className="dsh-git-repo-path" title={status?.root ?? scope.cwd}>
            {status?.root ?? scope.cwd ?? '当前会话没有工作目录'}
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="dsh-git-header-actions">
          {/* Sync Dropdown Button */}
          {status?.isRepo && (
            <div className="dsh-git-sync-wrap">
              <button
                type="button"
                className={`dsh-git-icon-btn ${syncing ? 'is-spinning' : ''}`}
                title="同步 / 抓取 / 推送 / 拉取"
                disabled={syncing || busyKey !== null}
                onClick={() => setShowSyncMenu(!showSyncMenu)}
              >
                <IconSync size={14} />
              </button>
              {showSyncMenu && (
                <div className="dsh-git-sync-menu">
                  <button
                    type="button"
                    className="dsh-git-menu-item"
                    onClick={() => void handleSyncAction('sync')}
                  >
                    <IconSync size={13} />
                    <span>同步 (Sync: Pull & Push)</span>
                  </button>
                  <button
                    type="button"
                    className="dsh-git-menu-item"
                    onClick={() => void handleSyncAction('pull')}
                  >
                    <IconDownload size={13} />
                    <span>拉取 (Pull) {sync && sync.behind > 0 ? `(${sync.behind})` : ''}</span>
                  </button>
                  <button
                    type="button"
                    className="dsh-git-menu-item"
                    onClick={() => void handleSyncAction('push')}
                  >
                    <IconUpload size={13} />
                    <span>推送 (Push) {sync && sync.ahead > 0 ? `(${sync.ahead})` : ''}</span>
                  </button>
                  <button
                    type="button"
                    className="dsh-git-menu-item"
                    onClick={() => void handleSyncAction('fetch')}
                  >
                    <IconRefresh size={13} />
                    <span>抓取 (Fetch)</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Refresh Button */}
          <button
            type="button"
            className="dsh-git-icon-btn"
            aria-label="刷新"
            title="刷新仓库状态"
            onClick={() => void refresh()}
            disabled={loading || busyKey !== null || syncing}
          >
            <IconRefresh size={14} />
          </button>
        </div>
      </header>

      {/* Tabs & View Controls */}
      <div className="dsh-git-tabs-bar">
        <nav className="dsh-git-tabs" aria-label="Git 视图切换">
          <button
            type="button"
            className="dsh-git-tab-btn"
            data-active={mode === 'changes' ? 'true' : undefined}
            onClick={() => setMode('changes')}
          >
            <span>更改</span>
            {(staged.length + unstaged.length > 0) && (
              <span className="dsh-git-badge-pill">{staged.length + unstaged.length}</span>
            )}
          </button>
          <button
            type="button"
            className="dsh-git-tab-btn"
            data-active={mode === 'history' ? 'true' : undefined}
            onClick={() => setMode('history')}
          >
            <span>历史</span>
            {history.length > 0 && <span className="dsh-git-badge-pill">{history.length}</span>}
          </button>
        </nav>

        {mode === 'changes' && status?.isRepo && (
          <div className="dsh-git-toolbar-actions">
            {/* Stash Actions Menu */}
            <div className="dsh-git-stash-wrap">
              <button
                type="button"
                className="dsh-git-action-btn"
                title="工作区暂存 (Stash)"
                onClick={() => setShowStashMenu(!showStashMenu)}
              >
                <IconArchive size={13} />
                {stashes.length > 0 && <span className="dsh-git-dot-badge" />}
              </button>
              {showStashMenu && (
                <div className="dsh-git-stash-menu">
                  <button
                    type="button"
                    className="dsh-git-menu-item"
                    onClick={() => {
                      setShowStashMenu(false)
                      setShowStashModal(true)
                    }}
                  >
                    <IconArchive size={13} />
                    <span>暂存当前工作区 (Stash)...</span>
                  </button>
                  {stashes.length > 0 && (
                    <>
                      <div className="dsh-git-menu-divider" />
                      <button
                        type="button"
                        className="dsh-git-menu-item"
                        onClick={() => void handleStashPop()}
                      >
                        <IconUndo size={13} />
                        <span>弹出最新暂存 (Pop stash@{'{0}'})</span>
                      </button>
                      <div className="dsh-git-stash-list-hint">已保存的暂存 ({stashes.length}):</div>
                      {stashes.slice(0, 5).map(s => (
                        <div key={s.index} className="dsh-git-stash-row">
                          <span className="dsh-git-stash-msg" title={s.message}>{s.message || `stash@{${s.index}}`}</span>
                          <button
                            type="button"
                            className="dsh-git-btn-link"
                            onClick={() => void handleStashPop(s.index)}
                            title="恢复并丢弃此项"
                          >
                            恢复
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Tree / Flat View Toggle Button */}
            <button
              type="button"
              className="dsh-git-action-btn"
              title={viewMode === 'tree' ? '切换为列表视图 (Flat View)' : '切换为树形视图 (Tree View)'}
              onClick={() => setViewMode(viewMode === 'tree' ? 'flat' : 'tree')}
            >
              {viewMode === 'tree' ? <IconList size={14} /> : <IconTree size={14} />}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="dsh-git-banner-error">
          <span className="dsh-git-banner-text">{error}</span>
          <button type="button" className="dsh-git-banner-close" onClick={() => setError(null)}>
            <IconClose size={12} />
          </button>
        </div>
      )}

      {!status?.isRepo ? (
        <Empty
          title="未检测到 Git 仓库"
          detail="请在 Git 仓库目录中打开当前会话，或将会话工作目录切换到仓库根路径。"
        />
      ) : (
        <div className="dsh-git-body">
          <div className="dsh-git-list-pane">
            {mode === 'changes' ? (
              <>
                {/* Staged Changes Group */}
                <ChangeGroup
                  title="暂存的更改"
                  entries={staged}
                  staged
                  busyKey={busyKey}
                  selected={selected}
                  viewMode={viewMode}
                  onSelect={openDiff}
                  onToggle={entry => void mutate(`unstage:${entry.path}`, 'git.unstage', { path: entry.path })}
                  onToggleAll={() => void mutate('unstage:all', 'git.unstage', {})}
                />

                {/* Unstaged Changes Group */}
                <ChangeGroup
                  title="更改"
                  entries={unstaged}
                  staged={false}
                  busyKey={busyKey}
                  selected={selected}
                  viewMode={viewMode}
                  onSelect={openDiff}
                  onToggle={entry => void mutate(`stage:${entry.path}`, 'git.stage', { path: entry.path })}
                  onToggleAll={() => void mutate('stage:all', 'git.stage', {})}
                  onDiscard={setDiscard}
                  onDiscardAll={() => setDiscardAllPrompt(true)}
                  onOpenFile={onOpenFile}
                />

                {status.truncated && (
                  <div className="dsh-git-notice">变更文件过多，仅显示前 2000 项。</div>
                )}

                {/* Commit Area */}
                <div className="dsh-git-commit-box">
                  <textarea
                    className="dsh-git-commit-input"
                    rows={2}
                    value={commitMessage}
                    onChange={event => setCommitMessage(event.target.value)}
                    onKeyDown={event => {
                      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                        event.preventDefault()
                        handleCommit()
                      }
                    }}
                    placeholder="输入提交信息 (Ctrl+Enter 快速提交)"
                  />
                  <div className="dsh-git-commit-actions">
                    <button
                      type="button"
                      className="dsh-git-btn-primary"
                      disabled={!commitMessage.trim() || staged.length === 0 || busyKey !== null}
                      onClick={handleCommit}
                      title={staged.length === 0 ? '请先暂存要提交的更改' : '提交已暂存的更改'}
                    >
                      {busyKey === 'commit' ? '正在提交…' : `提交${staged.length ? ` (${staged.length})` : ''}`}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <HistoryList
                entries={history}
                selected={selected}
                onSelect={openDiff}
                hasMore={hasMoreHistory}
                loadingMore={loadingMoreHistory}
                onLoadMore={handleLoadMoreHistory}
              />
            )}
          </div>

          {/* Embedded Diff Preview */}
          {selected && (
            <DiffPane
              target={selected}
              diff={diff}
              loading={diffLoading}
              initialLayout={defaultLayout}
              onDetach={() => detach(selected)}
              onClose={() => { setSelected(null); setDiff(null) }}
              onApplyHunk={handleApplyHunk}
            />
          )}
        </div>
      )}

      {/* Discard Single File Confirmation */}
      {discard && (
        <ConfirmModal
          title="丢弃文件更改？"
          description={`“${discard.path}” 的更改将无法恢复（未跟踪的新增文件将直接删除）。`}
          confirmLabel="丢弃更改"
          onCancel={() => setDiscard(null)}
          onConfirm={() => {
            const target = discard
            setDiscard(null)
            void mutate(`discard:${target.path}`, 'git.discard', { path: target.path })
          }}
        />
      )}

      {/* Discard All Unstaged Changes Confirmation */}
      {discardAllPrompt && (
        <ConfirmModal
          title="丢弃所有未暂存的更改？"
          description={`将丢弃所有 ${unstaged.length} 个未暂存文件的更改（包括未跟踪文件），操作不可撤销。`}
          confirmLabel="全部丢弃"
          onCancel={() => setDiscardAllPrompt(false)}
          onConfirm={async () => {
            setDiscardAllPrompt(false)
            for (const item of unstaged) {
              await call('git.discard', repoScope, { path: item.path }).catch(() => {})
            }
            setSelected(null)
            setDiff(null)
            await refresh(true)
          }}
        />
      )}

      {/* Stash Input Modal */}
      {showStashModal && (
        <div
          className="dsh-git-modal-backdrop"
          onMouseDown={e => {
            if (e.currentTarget === e.target) setShowStashModal(false)
          }}
        >
          <div className="dsh-git-modal-card" role="dialog" aria-modal="true">
            <h3 className="dsh-git-modal-title">暂存工作区修改 (Git Stash)</h3>
            <p className="dsh-git-modal-desc">可输入可选的备注说明，未跟踪的文件也将一并暂存。</p>
            <input
              type="text"
              className="dsh-git-input-modal"
              placeholder="暂存说明 (可选，默认 WIP)"
              value={stashMsg}
              onChange={e => setStashMsg(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleStash()
                }
              }}
              autoFocus
            />
            <div className="dsh-git-modal-actions">
              <button type="button" className="dsh-git-btn-secondary" onClick={() => setShowStashModal(false)}>
                取消
              </button>
              <button type="button" className="dsh-git-btn-primary" onClick={() => void handleStash()}>
                执行暂存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface FileTreeNode {
  name: string
  fullPath: string
  isDir: boolean
  children?: FileTreeNode[]
  entry?: GitStatusEntry
  count: number
}

function buildFileTree(entries: GitStatusEntry[]): FileTreeNode[] {
  const root: FileTreeNode = { name: '', fullPath: '', isDir: true, children: [], count: 0 }
  for (const entry of entries) {
    const cleanPath = entry.path.replace(/\\/g, '/')
    const parts = cleanPath.split('/')
    let curr = root
    curr.count++
    let currPath = ''
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      currPath = currPath ? `${currPath}/${part}` : part
      const isFile = i === parts.length - 1
      let child = curr.children!.find(c => c.name === part && c.isDir === !isFile)
      if (!child) {
        child = {
          name: part,
          fullPath: currPath,
          isDir: !isFile,
          children: isFile ? undefined : [],
          entry: isFile ? entry : undefined,
          count: 0,
        }
        curr.children!.push(child)
      }
      child.count++
      curr = child
    }
  }

  const sortNodes = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const n of nodes) {
      if (n.children) sortNodes(n.children)
    }
  }
  sortNodes(root.children!)
  return root.children!
}

function TreeItemNode(props: {
  node: FileTreeNode
  depth: number
  staged: boolean
  busyKey: string | null
  selected: DiffTarget | null
  onSelect: (target: DiffTarget) => void
  onToggle: (entry: GitStatusEntry) => void
  onDiscard?: (entry: GitStatusEntry) => void
  onOpenFile?: (path: string) => void
}): JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const { node, depth } = props

  if (node.isDir) {
    return (
      <div className="dsh-git-tree-dir-block">
        <div
          className="dsh-git-tree-dir-row"
          style={{ paddingLeft: `${depth * 14 + 10}px` }}
          onClick={() => setCollapsed(!collapsed)}
        >
          <span className="dsh-git-chevron" data-collapsed={collapsed ? 'true' : undefined}>▾</span>
          <span className="dsh-git-tree-folder-icon"><IconFolder size={13} /></span>
          <span className="dsh-git-tree-folder-name" title={node.fullPath}>{node.name}</span>
          <span className="dsh-git-tree-badge">{node.count}</span>
        </div>
        {!collapsed && node.children?.map(child => (
          <TreeItemNode
            key={`${props.staged ? 's' : 'u'}:${child.fullPath}`}
            node={child}
            depth={depth + 1}
            staged={props.staged}
            busyKey={props.busyKey}
            selected={props.selected}
            onSelect={props.onSelect}
            onToggle={props.onToggle}
            onDiscard={props.onDiscard}
            onOpenFile={props.onOpenFile}
          />
        ))}
      </div>
    )
  }

  const entry = node.entry!
  const active =
    props.selected?.kind === 'change' &&
    props.selected.entry.path === entry.path &&
    props.selected.staged === props.staged

  return (
    <div
      className="dsh-git-file-row dsh-git-tree-file-row"
      data-active={active ? 'true' : undefined}
      style={{ paddingLeft: `${depth * 14 + 10}px` }}
    >
      <button
        type="button"
        className="dsh-git-file-main"
        title={entry.path}
        onClick={() => props.onSelect({ kind: 'change', entry, staged: props.staged })}
      >
        <StatusBadge entry={entry} />
        <span className="dsh-git-file-name">{node.name}</span>
      </button>
      <div className="dsh-git-row-actions">
        {props.onOpenFile && (
          <button
            type="button"
            className="dsh-git-action-btn"
            title="在编辑器中打开"
            onClick={() => props.onOpenFile?.(entry.path)}
          >
            <IconOpenExternal size={13} />
          </button>
        )}
        {props.onDiscard && (
          <button
            type="button"
            className="dsh-git-action-btn dsh-git-action-btn-danger"
            title="丢弃此文件的更改"
            onClick={() => props.onDiscard?.(entry)}
          >
            <IconUndo size={13} />
          </button>
        )}
        <button
          type="button"
          className="dsh-git-action-btn"
          disabled={props.busyKey?.endsWith(entry.path)}
          title={props.staged ? '取消暂存' : '暂存'}
          onClick={() => props.onToggle(entry)}
        >
          {props.staged ? <IconMinus size={13} /> : <IconPlus size={13} />}
        </button>
      </div>
    </div>
  )
}

/* ── Change Group (Staged / Unstaged) ── */
function ChangeGroup(props: {
  title: string
  entries: GitStatusEntry[]
  staged: boolean
  busyKey: string | null
  selected: DiffTarget | null
  viewMode?: 'flat' | 'tree'
  onSelect: (target: DiffTarget) => void
  onToggle: (entry: GitStatusEntry) => void
  onToggleAll?: () => void
  onDiscard?: (entry: GitStatusEntry) => void
  onDiscardAll?: () => void
  onOpenFile?: (path: string) => void
}): JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const isTree = props.viewMode === 'tree'
  const treeNodes = useMemo(() => (isTree ? buildFileTree(props.entries) : []), [isTree, props.entries])

  return (
    <section className="dsh-git-section">
      <div className="dsh-git-section-header" onClick={() => setCollapsed(!collapsed)}>
        <div className="dsh-git-section-title">
          <span className="dsh-git-chevron" data-collapsed={collapsed ? 'true' : undefined}>▾</span>
          <span>{props.title}</span>
          <span className="dsh-git-section-count">{props.entries.length}</span>
        </div>
        <div className="dsh-git-section-actions" onClick={e => e.stopPropagation()}>
          {props.entries.length > 0 && props.onDiscardAll && (
            <button
              type="button"
              className="dsh-git-action-btn dsh-git-action-btn-danger"
              title="全部丢弃更改"
              onClick={props.onDiscardAll}
            >
              <IconUndo size={13} />
            </button>
          )}
          {props.entries.length > 0 && props.onToggleAll && (
            <button
              type="button"
              className="dsh-git-action-btn"
              title={props.staged ? '全部取消暂存' : '全部暂存'}
              onClick={props.onToggleAll}
            >
              {props.staged ? <IconMinus size={13} /> : <IconPlus size={13} />}
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="dsh-git-section-body">
          {props.entries.length === 0 ? (
            <div className="dsh-git-empty-hint">无更改</div>
          ) : isTree ? (
            treeNodes.map(node => (
              <TreeItemNode
                key={`${props.staged ? 's' : 'u'}:${node.fullPath}`}
                node={node}
                depth={0}
                staged={props.staged}
                busyKey={props.busyKey}
                selected={props.selected}
                onSelect={props.onSelect}
                onToggle={props.onToggle}
                onDiscard={props.onDiscard}
                onOpenFile={props.onOpenFile}
              />
            ))
          ) : (
            props.entries.map(entry => {
              const active =
                props.selected?.kind === 'change' &&
                props.selected.entry.path === entry.path &&
                props.selected.staged === props.staged
              return (
                <div
                  key={`${props.staged ? 's' : 'u'}:${entry.path}`}
                  className="dsh-git-file-row"
                  data-active={active ? 'true' : undefined}
                >
                  <button
                    type="button"
                    className="dsh-git-file-main"
                    title={entry.path}
                    onClick={() => props.onSelect({ kind: 'change', entry, staged: props.staged })}
                  >
                    <StatusBadge entry={entry} />
                    <span className="dsh-git-file-name">{fileName(entry.path)}</span>
                    <span className="dsh-git-file-dir">{dirName(entry.path)}</span>
                  </button>
                  <div className="dsh-git-row-actions">
                    {props.onOpenFile && (
                      <button
                        type="button"
                        className="dsh-git-action-btn"
                        title="在编辑器中打开"
                        onClick={() => props.onOpenFile?.(entry.path)}
                      >
                        <IconOpenExternal size={13} />
                      </button>
                    )}
                    {props.onDiscard && (
                      <button
                        type="button"
                        className="dsh-git-action-btn dsh-git-action-btn-danger"
                        title="丢弃此文件的更改"
                        onClick={() => props.onDiscard?.(entry)}
                      >
                        <IconUndo size={13} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="dsh-git-action-btn"
                      disabled={props.busyKey?.endsWith(entry.path)}
                      title={props.staged ? '取消暂存' : '暂存'}
                      onClick={() => props.onToggle(entry)}
                    >
                      {props.staged ? <IconMinus size={13} /> : <IconPlus size={13} />}
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </section>
  )
}

/* ── Commit History List (Timeline Tree Rail) ── */
function HistoryList({
  entries,
  selected,
  onSelect,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  entries: GitLogEntry[]
  selected: DiffTarget | null
  onSelect: (target: DiffTarget) => void
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
}): JSX.Element {
  const [copiedHash, setCopiedHash] = useState<string | null>(null)

  const handleCopyHash = (e: React.MouseEvent, fullHash: string) => {
    e.stopPropagation()
    void navigator.clipboard.writeText(fullHash).then(() => {
      setCopiedHash(fullHash)
      setTimeout(() => {
        setCopiedHash(prev => (prev === fullHash ? null : prev))
      }, 1500)
    })
  }

  if (!entries.length) {
    return <Empty title="暂无提交记录" detail="当仓库有新的提交时，将在此处展示提交历史。" />
  }

  return (
    <div className="dsh-git-tree-list">
      {entries.map((entry, index) => {
        const isFirst = index === 0
        const isLast = index === entries.length - 1 && !hasMore
        const active = selected?.kind === 'commit' && selected.entry.hashFull === entry.hashFull
        const isCopied = copiedHash === entry.hashFull

        const refTags = (entry.refs || '')
          .split(',')
          .map(r => r.trim())
          .filter(Boolean)

        return (
          <div
            key={entry.hashFull}
            className="dsh-git-tree-row"
            data-active={active ? 'true' : undefined}
            onClick={() => onSelect({ kind: 'commit', entry })}
          >
            {/* Timeline Rail */}
            <div className="dsh-git-tree-rail">
              {!isFirst && <div className="dsh-git-tree-line top" />}
              <div
                className={`dsh-git-tree-node ${isFirst ? 'is-head' : ''} ${active ? 'is-active' : ''}`}
                title={isFirst ? 'HEAD / 最新提交' : `Commit: ${entry.hash}`}
              />
              {!isLast && <div className="dsh-git-tree-line bottom" />}
            </div>

            {/* Commit Content Card */}
            <div className="dsh-git-tree-card">
              <div className="dsh-git-tree-main">
                <span className="dsh-git-tree-subject" title={entry.subject}>
                  {entry.subject}
                </span>
                {refTags.length > 0 && (
                  <div className="dsh-git-tree-refs">
                    {refTags.map(ref => {
                      const isHead = ref.includes('HEAD')
                      const isTag = ref.startsWith('tag:')
                      const label = ref.replace(/^tag:\s*/, '')
                      return (
                        <span
                          key={ref}
                          className={`dsh-git-ref-pill ${isHead ? 'is-head' : isTag ? 'is-tag' : 'is-branch'}`}
                          title={ref}
                        >
                          {label}
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="dsh-git-tree-meta">
                <button
                  type="button"
                  className={`dsh-git-hash-btn ${isCopied ? 'is-copied' : ''}`}
                  onClick={e => handleCopyHash(e, entry.hashFull)}
                  title={isCopied ? '已复制完整 SHA' : `点击复制完整 SHA: ${entry.hashFull}`}
                >
                  {isCopied ? <IconCheck size={11} /> : <IconCopy size={11} />}
                  <code>{entry.hash}</code>
                </button>
                <span className="dsh-git-meta-divider">·</span>
                <span className="dsh-git-author" title={entry.author}>{entry.author}</span>
                <span className="dsh-git-meta-divider">·</span>
                <span className="dsh-git-date" title={entry.date}>{relativeDate(entry.date)}</span>
              </div>
            </div>
          </div>
        )
      })}

      {/* Load More Button */}
      {hasMore && onLoadMore && (
        <div className="dsh-git-tree-load-more">
          <div className="dsh-git-tree-rail">
            <div className="dsh-git-tree-line top" />
            <div className="dsh-git-tree-node is-more" />
          </div>
          <button
            type="button"
            className="dsh-git-load-more-btn"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? 'Loading...' : `加载更多提交 (已显示 ${entries.length} 条)`}
          </button>
        </div>
      )}

      {!hasMore && entries.length > 10 && (
        <div className="dsh-git-tree-end">
          <span>已到达仓库提交历史起点</span>
        </div>
      )}
    </div>
  )
}

/* ── Diff Pane (Embedded inside Sidebar) ── */
function DiffPane({
  target,
  diff,
  loading,
  initialLayout,
  onDetach,
  onClose,
  onApplyHunk,
}: {
  target: DiffTarget
  diff: string | null
  loading: boolean
  initialLayout: DiffLayout
  onDetach: () => void
  onClose: () => void
  onApplyHunk?: (patch: string, reverse: boolean) => Promise<void>
}): JSX.Element {
  const [layout, setLayout] = useState<DiffLayout>(initialLayout)
  const title = targetTitle(target)

  return (
    <section className="dsh-git-diff-pane">
      <header className="dsh-git-diff-header">
        <span className="dsh-git-diff-title" title={title}>{title}</span>
        <div className="dsh-git-diff-actions">
          <LayoutSwitch value={layout} onChange={setLayout} />
          <button type="button" className="dsh-git-action-btn" onClick={onDetach} title="在工作区以独立标签页打开">
            <IconOpenExternal size={13} />
          </button>
          <button type="button" className="dsh-git-action-btn" onClick={onClose} title="关闭差异预览">
            <IconClose size={13} />
          </button>
        </div>
      </header>
      {loading ? (
        <div className="dsh-git-loading-box">
          <Centered label="Loading..." />
          <button
            type="button"
            className="dsh-git-btn-secondary"
            style={{ margin: '0 auto', display: 'block', fontSize: 11 }}
            onClick={onClose}
          >
            取消
          </button>
        </div>
      ) : !diff ? (
        <Empty title="没有差异变更" detail="该文件内容与基准版本一致，或者已全部暂存/丢弃。" />
      ) : (
        <DiffContent
          content={diff}
          layout={layout}
          wrap={layout === 'split'}
          target={target}
          onApplyHunk={onApplyHunk}
        />
      )}
    </section>
  )
}

/* ── Full Diff Viewer for .diff / .patch Files ── */
function DiffViewer({ content, path, store }: { content?: string; path: string; store?: any }): JSX.Element {
  const settings = usePluginSettings(store, DIFF_ID)
  const [layout, setLayout] = useState<DiffLayout>('unified')

  return (
    <div className="dsh-git-root">
      <GlobalDshStyle />
      <header className="dsh-git-header">
        <div className="dsh-git-header-info">
          <div className="dsh-git-branch-row">
            <span className="dsh-git-branch-name">{fileName(path)}</span>
          </div>
          <div className="dsh-git-repo-path">{path}</div>
        </div>
        <LayoutSwitch value={layout} onChange={setLayout} />
      </header>
      <DiffContent
        content={content ?? ''}
        layout={layout}
        wrap={layout === 'split' || boolSetting(settings.wrapLines, false)}
      />
    </div>
  )
}

/* ── Detached Diff Tab in Main Workbench ── */
function DetachedDiff({ scope, tab, store }: { scope: SessionScope; tab: any; store?: any }): JSX.Element {
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
    setDiff(null)
    setError(null)
    void loadTargetDiff(meta.target, targetScope, meta.repoRoot ?? scope.cwd).then(
      value => { if (!cancelled) setDiff(value) },
      reason => { if (!cancelled) setError(messageOf(reason)) },
    )
    return () => { cancelled = true }
  }, [scope.sessionId, scope.cwd, meta?.repoRoot, meta?.target, tick])

  if (!meta?.target) {
    return (
      <div className="dsh-git-root">
        <GlobalDshStyle />
        <Empty title="Diff 数据不可用" detail="请从 Git 变更列表或历史记录重新拉起差异。" />
      </div>
    )
  }

  return (
    <div className="dsh-git-root">
      <GlobalDshStyle />
      <header className="dsh-git-header">
        <div className="dsh-git-header-info">
          <div className="dsh-git-branch-row">
            <span className="dsh-git-branch-name">{targetTitle(meta.target)}</span>
          </div>
          <div className="dsh-git-repo-path">{meta.repoRoot ?? scope.cwd}</div>
        </div>
        <div className="dsh-git-diff-actions">
          <LayoutSwitch value={layout} onChange={setLayout} />
          <button
            type="button"
            className="dsh-git-icon-btn"
            title="刷新 Diff"
            onClick={() => setTick(v => v + 1)}
          >
            <IconRefresh size={14} />
          </button>
        </div>
      </header>
      {error ? (
        <div className="dsh-git-banner-error">{error}</div>
      ) : diff === null ? (
        <Centered label="Loading..." />
      ) : !diff ? (
        <Empty title="无差异内容" detail="目标文件与对应版本一致。" />
      ) : (
        <DiffContent content={diff} layout={layout} wrap={layout === 'split'} />
      )}
    </div>
  )
}

/* ── Diff Layout & Multi-file Document Engine (Protected from giant commits) ── */
type DiffLayout = 'unified' | 'split'

function LayoutSwitch({ value, onChange }: { value: DiffLayout; onChange: (value: DiffLayout) => void }): JSX.Element {
  return (
    <div className="dsh-git-layout-switch" aria-label="Diff 排版模式">
      <button
        type="button"
        title="单栏统一视图"
        aria-pressed={value === 'unified'}
        className="dsh-git-layout-btn"
        data-active={value === 'unified' ? 'true' : undefined}
        onClick={() => onChange('unified')}
      >
        <IconDiffUnified size={13} />
        <span>统一</span>
      </button>
      <button
        type="button"
        title="双栏左右对比"
        aria-pressed={value === 'split'}
        className="dsh-git-layout-btn"
        data-active={value === 'split' ? 'true' : undefined}
        onClick={() => onChange('split')}
      >
        <IconDiffSplit size={13} />
        <span>分栏</span>
      </button>
    </div>
  )
}

function parseGitDiffFiles(rawDiff: string): ParsedDiffFile[] {
  if (!rawDiff) return []
  if (!rawDiff.includes('diff --git')) {
    const lines = rawDiff.split('\n')
    let additions = 0, deletions = 0
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++
      else if (line.startsWith('-') && !line.startsWith('---')) deletions++
    }
    return [{ path: '', additions, deletions, lines }]
  }

  const files: ParsedDiffFile[] = []
  const blocks = rawDiff.split(/^diff --git /m)

  for (const block of blocks) {
    if (!block.trim()) continue
    const lines = block.split('\n')
    const headerLine = lines[0] ?? ''
    const match = headerLine.match(/^[ab]\/(.*?)\s+[ab]\/(.*?)$/)
    const filePath = match ? (match[2] || match[1]) : (headerLine.split(' ').pop() || 'file')

    let additions = 0
    let deletions = 0
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!
      if (line.startsWith('+') && !line.startsWith('+++')) additions++
      else if (line.startsWith('-') && !line.startsWith('---')) deletions++
    }

    files.push({
      path: filePath,
      additions,
      deletions,
      lines: [`diff --git ${lines[0]}`, ...lines.slice(1)],
    })

    if (files.length >= MAX_DIFF_FILES) break
  }

  return files
}

function DiffContent({
  content,
  layout,
  wrap,
  target,
  onApplyHunk,
}: {
  content: string
  layout: DiffLayout
  wrap: boolean
  target?: DiffTarget
  onApplyHunk?: (patch: string, reverse: boolean) => Promise<void>
}): JSX.Element {
  const files = useMemo(() => parseGitDiffFiles(content), [content])
  const canHunk = Boolean(onApplyHunk && target?.kind === 'change')
  const staged = target?.kind === 'change' ? target.staged : false

  if (files.length === 0) {
    return <Empty title="没有可显示的差异" detail="内容可能未发生变动。" />
  }

  // 单文件直接渲染
  if (files.length === 1 && !files[0]!.path) {
    return layout === 'split' ? (
      <SplitDiff lines={files[0]!.lines} wrap={wrap} />
    ) : (
      <DiffCode
        lines={files[0]!.lines}
        wrap={wrap}
        staged={staged}
        onApplyHunk={canHunk ? onApplyHunk : undefined}
      />
    )
  }

  // 多文件变更（如 Commit Patch）：采用文件手风琴树状折叠，防止成百上千个文件直接生成几十万 DOM 卡死页面
  return (
    <div className="dsh-git-multifile-root">
      <div className="dsh-git-multifile-header">
        <span>变更文件 ({files.length}{content.includes('diff --git') && files.length >= MAX_DIFF_FILES ? '+' : ''})</span>
      </div>
      <div className="dsh-git-multifile-list">
        {files.map((file, index) => (
          <DiffFileAccordion
            key={`${file.path}-${index}`}
            file={file}
            layout={layout}
            wrap={wrap}
            defaultExpanded={index === 0 && files.length <= 2}
            staged={staged}
            onApplyHunk={canHunk ? onApplyHunk : undefined}
          />
        ))}
      </div>
    </div>
  )
}

function DiffFileAccordion({
  file,
  layout,
  wrap,
  defaultExpanded,
  staged,
  onApplyHunk,
}: {
  file: ParsedDiffFile
  layout: DiffLayout
  wrap: boolean
  defaultExpanded?: boolean
  staged?: boolean
  onApplyHunk?: (patch: string, reverse: boolean) => Promise<void>
}) {
  const [expanded, setExpanded] = useState(Boolean(defaultExpanded))

  return (
    <div className="dsh-git-file-block">
      <button
        type="button"
        className="dsh-git-file-block-trigger"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="dsh-git-chevron" data-collapsed={!expanded ? 'true' : undefined}>▾</span>
        <span className="dsh-git-file-block-name" title={file.path}>{file.path}</span>
        <span className="dsh-git-file-block-stats">
          {file.additions > 0 && <span className="dsh-git-stat-add">+{file.additions}</span>}
          {file.deletions > 0 && <span className="dsh-git-stat-del">−{file.deletions}</span>}
        </span>
      </button>
      {expanded && (
        <div className="dsh-git-file-block-content">
          {layout === 'split' ? (
            <SplitDiff lines={file.lines} wrap={wrap} />
          ) : (
            <DiffCode
              lines={file.lines}
              wrap={wrap}
              staged={staged}
              onApplyHunk={onApplyHunk}
            />
          )}
        </div>
      )}
    </div>
  )
}

/* ── Code Diff Renderers with safety row-capping & Hunk Staging ── */
function DiffCode({
  lines,
  wrap,
  staged,
  onApplyHunk,
}: {
  lines: string[]
  wrap: boolean
  staged?: boolean
  onApplyHunk?: (patch: string, reverse: boolean) => Promise<void>
}): JSX.Element {
  const [limit, setLimit] = useState(DIFF_PAGE_SIZE)
  const [hunkBusyIdx, setHunkBusyIdx] = useState<number | null>(null)
  const visibleLines = lines.slice(0, limit)
  const hasMore = lines.length > limit

  // 提取文件头部行（直到第一个 @@ 之前）
  const firstHunkIndex = lines.findIndex(l => l.startsWith('@@'))
  const fileHeader = firstHunkIndex > 0 ? lines.slice(0, firstHunkIndex) : []

  const handleHunkClick = async (hunkLineIndex: number) => {
    if (!onApplyHunk) return
    setHunkBusyIdx(hunkLineIndex)
    try {
      const nextHunkRel = lines.slice(hunkLineIndex + 1).findIndex(l => l.startsWith('@@'))
      const nextHunkIndex = nextHunkRel === -1 ? lines.length : hunkLineIndex + 1 + nextHunkRel
      const hunkLines = lines.slice(hunkLineIndex, nextHunkIndex)
      const patch = [...fileHeader, ...hunkLines, ''].join('\n')
      await onApplyHunk(patch, Boolean(staged))
    } finally {
      setHunkBusyIdx(null)
    }
  }

  return (
    <div className="dsh-git-diff-code-wrap">
      <pre className="dsh-git-diff-code" style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre' }}>
        {visibleLines.map((line, index) => {
          const isHunk = line.startsWith('@@')
          const kind =
            line.startsWith('+') && !line.startsWith('+++')
              ? 'add'
              : line.startsWith('-') && !line.startsWith('---')
              ? 'del'
              : isHunk
              ? 'hunk'
              : line.startsWith('diff ') || line.startsWith('index ')
              ? 'file'
              : 'plain'

          return (
            <div key={index} className="dsh-git-diff-line" data-kind={kind}>
              <span className="dsh-git-diff-lineno">{index + 1}</span>
              <span className="dsh-git-diff-sign">
                {kind === 'add' ? '+' : kind === 'del' ? '-' : ' '}
              </span>
              <span className="dsh-git-diff-text">
                {line.startsWith('+') || line.startsWith('-') ? line.slice(1) : line}
              </span>
              {isHunk && onApplyHunk && (
                <button
                  type="button"
                  className="dsh-git-hunk-btn"
                  disabled={hunkBusyIdx !== null}
                  title={staged ? '取消暂存此块更改 (Unstage Hunk)' : '暂存此块更改 (Stage Hunk)'}
                  onClick={() => void handleHunkClick(index)}
                >
                  {hunkBusyIdx === index ? '…' : staged ? '− 取消暂存块' : '+ 暂存此块'}
                </button>
              )}
            </div>
          )
        })}
      </pre>
      {hasMore && (
        <div className="dsh-git-overflow-banner">
          <span>已显示前 {limit} 行（共 {lines.length} 行）</span>
          <button
            type="button"
            className="dsh-git-btn-secondary"
            style={{ height: 22, padding: '0 8px', fontSize: 11 }}
            onClick={() => setLimit(prev => prev + DIFF_PAGE_SIZE)}
          >
            展开更多 (+{DIFF_PAGE_SIZE} 行)
          </button>
        </div>
      )}
    </div>
  )
}

interface SplitRow { oldNo?: number; newNo?: number; oldText?: string; newText?: string; kind: 'plain' | 'change' | 'header' }

function SplitDiff({ lines, wrap }: { lines: string[]; wrap: boolean }): JSX.Element {
  const [limit, setLimit] = useState(DIFF_PAGE_SIZE)
  const rows = useMemo(() => splitDiffRows(lines.slice(0, limit)), [lines, limit])
  const hasMore = lines.length > limit

  return (
    <div className="dsh-git-split-root">
      <div className="dsh-git-split-labels">
        <span>原始版本 (旧)</span>
        <span>修改版本 (新)</span>
      </div>
      <div className="dsh-git-split-scroll">
        {rows.map((row, index) =>
          row.kind === 'header' ? (
            <div key={index} className="dsh-git-split-header">{row.oldText}</div>
          ) : (
            <div key={index} className="dsh-git-split-row">
              <SplitCell
                no={row.oldNo}
                text={row.oldText}
                tone={row.kind === 'change' && row.oldText !== undefined ? 'del' : 'plain'}
                wrap={wrap}
              />
              <SplitCell
                no={row.newNo}
                text={row.newText}
                tone={row.kind === 'change' && row.newText !== undefined ? 'add' : 'plain'}
                wrap={wrap}
              />
            </div>
          ),
        )}
        {hasMore && (
          <div className="dsh-git-overflow-banner">
            <span>已显示前 {limit} 行（共 {lines.length} 行）</span>
            <button
              type="button"
              className="dsh-git-btn-secondary"
              style={{ height: 22, padding: '0 8px', fontSize: 11 }}
              onClick={() => setLimit(prev => prev + DIFF_PAGE_SIZE)}
            >
              展开更多 (+{DIFF_PAGE_SIZE} 行)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function SplitCell({
  no,
  text,
  tone,
  wrap,
}: {
  no?: number
  text?: string
  tone: 'plain' | 'add' | 'del'
  wrap: boolean
}): JSX.Element {
  return (
    <div className="dsh-git-split-cell" data-tone={tone}>
      <span className="dsh-git-split-no">{no ?? ''}</span>
      <span className="dsh-git-split-text" style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre' }}>
        {text ?? ''}
      </span>
    </div>
  )
}

function splitDiffRows(lines: string[]): SplitRow[] {
  const result: SplitRow[] = []
  let oldNo = 0, newNo = 0, index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) {
      oldNo = Number(hunk[1])
      newNo = Number(hunk[2])
      result.push({ kind: 'header', oldText: line })
      index += 1
      continue
    }
    if (
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('new file ') ||
      line.startsWith('deleted file ')
    ) {
      result.push({ kind: 'header', oldText: line })
      index += 1
      continue
    }
    if (line.startsWith('-')) {
      const removed: string[] = []
      const added: string[] = []
      while (index < lines.length && (lines[index] ?? '').startsWith('-') && !(lines[index] ?? '').startsWith('--- ')) {
        removed.push((lines[index] ?? '').slice(1))
        index += 1
      }
      while (index < lines.length && (lines[index] ?? '').startsWith('+') && !(lines[index] ?? '').startsWith('+++ ')) {
        added.push((lines[index] ?? '').slice(1))
        index += 1
      }
      const count = Math.max(removed.length, added.length)
      for (let at = 0; at < count; at += 1) {
        result.push({
          kind: 'change',
          oldNo: removed[at] === undefined ? undefined : oldNo++,
          newNo: added[at] === undefined ? undefined : newNo++,
          oldText: removed[at],
          newText: added[at],
        })
      }
      continue
    }
    if (line.startsWith('+')) {
      result.push({ kind: 'change', newNo: newNo++, newText: line.slice(1) })
      index += 1
      continue
    }
    if (line.startsWith(' ')) {
      result.push({ kind: 'plain', oldNo: oldNo++, newNo: newNo++, oldText: line.slice(1), newText: line.slice(1) })
      index += 1
      continue
    }
    if (line === '\\ No newline at end of file') {
      result.push({ kind: 'header', oldText: line })
      index += 1
      continue
    }
    result.push({ kind: 'header', oldText: line })
    index += 1
  }
  return result
}

/* ── Modal Dialog (Standard DSH Modal Style) ── */
function ConfirmModal(props: {
  title: string
  description: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}): JSX.Element {
  return (
    <div
      className="dsh-git-modal-backdrop"
      onMouseDown={event => {
        if (event.currentTarget === event.target) props.onCancel()
      }}
    >
      <div className="dsh-git-modal-card" role="alertdialog" aria-modal="true">
        <div className="dsh-git-modal-icon">!</div>
        <h3 className="dsh-git-modal-title">{props.title}</h3>
        <p className="dsh-git-modal-desc">{props.description}</p>
        <div className="dsh-git-modal-actions">
          <button type="button" className="dsh-git-btn-secondary" onClick={props.onCancel}>
            取消
          </button>
          <button type="button" className="dsh-git-btn-danger" onClick={props.onConfirm}>
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Hook: Read settings safely from SidebarStore (optional) ── */
function usePluginSettings(store: any, id: string): Record<string, unknown> {
  return useSyncExternalStore(
    useCallback(listener => (store?.subscribe ? store.subscribe(listener) : () => {}), [store]),
    useCallback(() => (store?.getSnapshot ? store.getSnapshot()?.prefs?.pluginSettings?.[id] ?? EMPTY_SETTINGS : EMPTY_SETTINGS), [store, id]),
  )
}

/* ── DSH Host RPC Call ── */
async function call<T = { ok: true }>(
  method: string,
  scope: SessionScope,
  extra: Record<string, unknown> = {},
): Promise<T> {
  const payload = {
    sessionId: scope.sessionId,
    ...(scope.cwd ? { cwd: scope.cwd } : {}),
    ...(scope.repoRoot ? { repoRoot: scope.repoRoot } : {}),
    ...extra,
  }

  // 优先请求本插件 Host 独立端点 /dsh-git/api/，失败自动回退 /sidebar/api/
  let response: Response | null = await fetch(`/dsh-git/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => null)

  if (!response || !response.ok) {
    response = await fetch(`/sidebar/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null)
  }

  if (!response) {
    throw new Error('网络请求失败：无法连接到 Git 后端服务')
  }

  const envelope = (await response.json().catch(() => null)) as {
    ok?: boolean
    value?: T
    error?: { message?: string }
  } | null

  if (!response.ok || envelope?.ok !== true || envelope.value === undefined) {
    throw new Error(envelope?.error?.message ?? `HTTP ${response.status}`)
  }
  return envelope.value
}

async function loadTargetDiff(target: DiffTarget, scope: SessionScope, root?: string): Promise<string> {
  if (target.kind === 'commit') {
    return (await call<{ diff: string }>('git.commit-diff', scope, { hash: target.entry.hashFull })).diff
  }
  const result = await call<{ diff: string }>('git.diff', scope, {
    path: target.entry.path,
    staged: target.staged,
  })
  if (result.diff || target.entry.xy !== '??') return result.diff
  const file = await call<{ kind: string; content?: string }>('fs.read', scope, {
    path: joinPath(root ?? '', target.entry.path),
  })
  return file.kind === 'text' ? addedDiff(target.entry.path, file.content ?? '') : ''
}

/* ── Pure Helpers ── */
const isStaged = (entry: GitStatusEntry): boolean => entry.xy[0] !== ' ' && entry.xy[0] !== '?'
const isUnstaged = (entry: GitStatusEntry): boolean => entry.xy === '??' || (entry.xy[1] !== ' ' && entry.xy[1] !== undefined)
const messageOf = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason))
const fileName = (path: string): string => path.replace(/\\/g, '/').split('/').pop() || path
const dirName = (path: string): string => {
  const value = path.replace(/\\/g, '/')
  const index = value.lastIndexOf('/')
  return index < 0 ? '' : value.slice(0, index)
}
const boolSetting = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)
const numberSetting = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
const joinPath = (root: string, path: string): string =>
  `${root.replace(/[\\/]+$/, '')}${root.includes('\\') ? '\\' : '/'}${path.replace(/^[\\/]+/, '')}`
const addedDiff = (path: string, content: string): string =>
  `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${content.split('\n').length} @@\n${content
    .split('\n')
    .map(line => `+${line}`)
    .join('\n')}`
const targetTitle = (target: DiffTarget): string =>
  target.kind === 'change' ? fileName(target.entry.path) : `${target.entry.hash} ${target.entry.subject}`
const detachedId = (target: DiffTarget, root?: string): string =>
  target.kind === 'change'
    ? `${DIFF_TAB_ID}:w:${encodeURIComponent(root ?? '')}:${target.staged ? 's' : 'u'}:${target.entry.path}`
    : `${DIFF_TAB_ID}:c:${target.entry.hashFull}`

const relativeDate = (value: string): string => {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return value
  const seconds = Math.floor((Date.now() - time) / 1000)
  if (seconds < 60) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(time).toLocaleDateString()
}

function StatusBadge({ entry }: { entry: GitStatusEntry }): JSX.Element {
  const mark = entry.xy === '??' ? '?' : entry.xy.includes('A') ? 'A' : entry.xy.includes('D') ? 'D' : entry.xy.includes('R') ? 'R' : 'M'
  return <span className="dsh-git-badge" data-letter={mark}>{mark}</span>
}

function Centered({ label = 'Loading...' }: { label?: string }): JSX.Element {
  return (
    <div className="dsh-git-centered">
      <div className="dsh-git-spinner" />
      <span className="dsh-git-loading-text">{label}</span>
    </div>
  )
}

function Empty({ title, detail }: { title: string; detail: string }): JSX.Element {
  return (
    <div className="dsh-git-empty">
      <div className="dsh-git-empty-icon"><IconBranch size={26} /></div>
      <div className="dsh-git-empty-title">{title}</div>
      <div className="dsh-git-empty-detail">{detail}</div>
    </div>
  )
}

/* ── Global Stylesheet Injector: DSH Semantic Design System ── */
function GlobalDshStyle(): JSX.Element {
  return (
    <style>{`
/* ── DSH Git Plugin Root ── */
.dsh-git-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  background: var(--dsw-alias-bg-base, #ffffff);
  color: var(--dsw-alias-label-primary, #17233c);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 12px;
  line-height: 1.4;
  overflow: hidden;
  position: relative;
}

/* ── Header ── */
.dsh-git-header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(118,137,166,.18));
}
.dsh-git-header-info {
  flex: 1;
  min-width: 0;
}
.dsh-git-branch-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.dsh-git-branch-icon {
  color: var(--dsw-alias-brand-primary, #4b70e2);
  display: flex;
}
.dsh-git-branch-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--dsw-alias-label-primary, inherit);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-git-repo-path {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #8c9ba5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 1px;
}
.dsh-git-branch-select-wrap {
  position: relative;
}
.dsh-git-branch-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 1px 4px;
  margin: -1px -4px;
  color: inherit;
  cursor: pointer;
  max-width: 200px;
}
.dsh-git-branch-trigger:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(100,120,150,.08));
  border-color: var(--dsw-alias-border-l2, rgba(118,137,166,.25));
}
.dsh-git-branch-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 1000;
  margin-top: 4px;
  min-width: 150px;
  max-height: 220px;
  overflow-y: auto;
  background: var(--dsw-alias-container-bg, var(--dsw-alias-bg-base, #ffffff));
  border: 1px solid var(--dsw-alias-border-l2, rgba(118,137,166,.25));
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,.15);
  padding: 4px;
}
.dsh-git-branch-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  border: none;
  background: transparent;
  border-radius: 4px;
  color: var(--dsw-alias-label-primary, inherit);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.dsh-git-branch-item:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(100,120,150,.1));
}
.dsh-git-branch-item[data-active='true'] {
  color: var(--dsw-alias-brand-primary, #4b70e2);
  font-weight: 600;
}

/* ── Buttons ── */
.dsh-git-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(118,137,166,.2));
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #6f7f9b);
  cursor: pointer;
  transition: all 0.15s ease;
}
.dsh-git-icon-btn:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary, #17233c);
  background: var(--dsw-alias-interactive-bg-hover, rgba(100,120,150,.08));
  border-color: var(--dsw-alias-border-l3, rgba(118,137,166,.35));
}
.dsh-git-icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.dsh-git-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #6f7f9b);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.dsh-git-action-btn:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary, #17233c);
  background: var(--dsw-alias-interactive-bg-hover, rgba(100,120,150,.12));
}
.dsh-git-action-btn-danger:hover:not(:disabled) {
  color: var(--dsw-alias-state-error-primary, #e34c59);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e34c59) 12%, transparent);
}
.dsh-git-action-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* ── Tabs ── */
.dsh-git-tabs {
  flex: none;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 12px;
  height: 34px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(118,137,166,.18));
}
.dsh-git-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding: 0 2px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #6f7f9b);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s ease;
}
.dsh-git-tab-btn:hover {
  color: var(--dsw-alias-label-primary, #17233c);
}
.dsh-git-tab-btn[data-active='true'] {
  color: var(--dsw-alias-label-primary, #17233c);
  font-weight: 600;
  border-bottom-color: var(--dsw-alias-brand-primary, #4b70e2);
}
.dsh-git-badge-pill {
  padding: 1px 6px;
  border-radius: 99px;
  font-size: 10px;
  font-weight: 600;
  background: var(--dsw-alias-interactive-bg-hover, rgba(100,120,150,.12));
  color: var(--dsw-alias-label-secondary, #6f7f9b);
}

/* ── Content Layout ── */
.dsh-git-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.dsh-git-list-pane {
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
  overflow-x: hidden;
}

/* ── Group Sections ── */
.dsh-git-section {
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(118,137,166,.12));
}
.dsh-git-section-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 6px 12px;
  background: var(--dsw-alias-bg-base, #ffffff);
  user-select: none;
  cursor: pointer;
}
.dsh-git-section-header:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(100,120,150,.06));
}
.dsh-git-section-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary, #6f7f9b);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.dsh-git-chevron {
  font-size: 10px;
  transition: transform 0.15s ease;
  display: inline-block;
}
.dsh-git-chevron[data-collapsed='true'] {
  transform: rotate(-90deg);
}
.dsh-git-section-count {
  font-weight: 500;
  opacity: 0.75;
}
.dsh-git-section-actions {
  display: flex;
  align-items: center;
  gap: 3px;
}
.dsh-git-empty-hint {
  padding: 8px 12px 10px;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #8c9ba5);
}

/* ── File Row (VS Code / DSH Hover Actions) ── */
.dsh-git-file-row {
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 4px 0 10px;
  position: relative;
  transition: background 0.12s ease;
}
.dsh-git-file-row:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(100,120,150,.08));
}
.dsh-git-file-row[data-active='true'] {
  background: var(--dsw-alias-interactive-bg-active, rgba(75,112,226,.18));
  box-shadow: inset 3px 0 0 var(--dsw-alias-brand-primary, #4b70e2);
}
.dsh-git-file-row[data-active='true'] .dsh-git-file-name {
  color: var(--dsw-alias-label-primary, inherit);
  font-weight: 600;
}
.dsh-git-file-row[data-active='true'] .dsh-git-file-dir {
  color: var(--dsw-alias-label-secondary, #94a3b8);
  opacity: 0.95;
}
.dsh-git-file-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  border: none;
  background: transparent;
  padding: 0;
  color: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}
.dsh-git-file-name {
  font-weight: 500;
  color: var(--dsw-alias-label-primary, inherit);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-git-file-dir {
  font-size: 10.5px;
  color: var(--dsw-alias-label-secondary, #94a3b8);
  opacity: 0.8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Hover-only action buttons */
.dsh-git-row-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}
.dsh-git-file-row:hover .dsh-git-row-actions,
.dsh-git-file-row[data-active='true'] .dsh-git-row-actions {
  opacity: 1;
  pointer-events: auto;
}

/* ── Status Badges (A / M / D / R / ?) ── */
.dsh-git-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 15px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
  user-select: none;
}
.dsh-git-badge[data-letter='A'], .dsh-git-badge[data-letter='?'] {
  color: var(--dsw-alias-state-success-primary, #1aa260);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #1aa260) 12%, transparent);
}
.dsh-git-badge[data-letter='M'], .dsh-git-badge[data-letter='R'] {
  color: var(--dsw-alias-state-business-primary, #3b82f6);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #3b82f6) 12%, transparent);
}
.dsh-git-badge[data-letter='D'] {
  color: var(--dsw-alias-state-error-primary, #e34c59);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e34c59) 12%, transparent);
}

/* ── Commit Area ── */
.dsh-git-commit-box {
  padding: 10px 12px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(118,137,166,.18));
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsh-git-commit-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 52px;
  padding: 7px 9px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(118,137,166,.25));
  border-radius: 6px;
  background: var(--dsw-alias-bg-base, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  font-family: inherit;
  font-size: 12px;
  line-height: 1.4;
  resize: vertical;
  outline: none;
  transition: border-color 0.15s ease;
}
.dsh-git-commit-input:focus {
  border-color: var(--dsw-alias-brand-primary, #4b70e2);
}
.dsh-git-commit-actions {
  display: flex;
  justify-content: flex-end;
}
.dsh-git-btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 72px;
  height: 28px;
  padding: 0 14px;
  border: none;
  border-radius: 6px;
  background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #4b70e2));
  color: var(--dsw-alias-label-primary-inverted, #ffffff);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease, filter 0.15s ease;
}
.dsh-git-btn-primary:hover:not(:disabled) {
  filter: brightness(1.08);
}
.dsh-git-btn-primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ── Git Timeline Tree Rail System ── */
.dsh-git-tree-list {
  display: flex;
  flex-direction: column;
  padding: 6px 0 16px;
}
.dsh-git-tree-row {
  display: flex;
  align-items: stretch;
  position: relative;
  padding: 0 10px 0 6px;
  cursor: pointer;
  transition: background 0.12s ease;
  user-select: none;
}
.dsh-git-tree-row:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(100,120,150,.08));
}
.dsh-git-tree-row[data-active='true'] {
  background: var(--dsw-alias-interactive-bg-active, rgba(75,112,226,.18));
}

/* Timeline Rail & Nodes */
.dsh-git-tree-rail {
  position: relative;
  width: 24px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dsh-git-tree-line {
  position: absolute;
  left: 50%;
  width: 2px;
  transform: translateX(-50%);
  background: var(--dsw-alias-border-l2, rgba(118,137,166,.25));
}
.dsh-git-tree-line.top {
  top: 0;
  bottom: 50%;
}
.dsh-git-tree-line.bottom {
  top: 50%;
  bottom: 0;
}
.dsh-git-tree-node {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dsw-alias-bg-base, #ffffff);
  border: 2px solid var(--dsw-alias-brand-primary, #4b70e2);
  z-index: 2;
  transition: all 0.15s ease;
  box-sizing: border-box;
}
.dsh-git-tree-node.is-head {
  width: 9px;
  height: 9px;
  background: var(--dsw-alias-brand-primary, #4b70e2);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary, #4b70e2) 35%, transparent);
}
.dsh-git-tree-node.is-active,
.dsh-git-tree-row[data-active='true'] .dsh-git-tree-node {
  background: var(--dsw-alias-brand-primary, #4b70e2);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #4b70e2) 35%, transparent), 0 0 8px var(--dsw-alias-brand-primary, #4b70e2);
  transform: translate(-50%, -50%) scale(1.15);
}
.dsh-git-tree-node.is-more {
  top: 50%;
  width: 5px;
  height: 5px;
  background: var(--dsw-alias-border-l3, rgba(118,137,166,.45));
  border: none;
}

/* Tree Commit Card */
.dsh-git-tree-card {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 5px 4px 6px 4px;
}
.dsh-git-tree-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dsh-git-tree-subject {
  font-size: 12px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary, inherit);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.35;
}
.dsh-git-tree-row[data-active='true'] .dsh-git-tree-subject {
  font-weight: 600;
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-git-tree-refs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.dsh-git-ref-pill {
  font-size: 9.5px;
  font-weight: 500;
  padding: 0 5px;
  border-radius: 99px;
  line-height: 15px;
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  border: 1px solid transparent;
}
.dsh-git-ref-pill.is-head {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #1aa260) 18%, transparent);
  color: var(--dsw-alias-state-success-primary, #1aa260);
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #1aa260) 35%, transparent);
  font-weight: 600;
}
.dsh-git-ref-pill.is-branch {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4b70e2) 18%, transparent);
  color: var(--dsw-alias-brand-primary, #4b70e2);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4b70e2) 35%, transparent);
}
.dsh-git-ref-pill.is-tag {
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f59e0b) 18%, transparent);
  color: var(--dsw-alias-state-warn-primary, #f59e0b);
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f59e0b) 35%, transparent);
}
.dsh-git-tree-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, #94a3b8);
  min-width: 0;
}
.dsh-git-hash-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0 4px;
  height: 16px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(100,120,150,.14));
  border: 1px solid var(--dsw-alias-border-l1, rgba(118,137,166,.2));
  border-radius: 3px;
  color: var(--dsw-alias-label-secondary, inherit);
  font-size: 10.5px;
  font-family: var(--ds-font-family-code, monospace);
  cursor: pointer;
  transition: all 0.12s ease;
  user-select: none;
}
.dsh-git-hash-btn:hover {
  color: var(--dsw-alias-label-primary, inherit);
  background: var(--dsw-alias-interactive-bg-hover, rgba(100,120,150,.24));
  border-color: var(--dsw-alias-border-l2, rgba(118,137,166,.4));
}
.dsh-git-hash-btn.is-copied {
  color: var(--dsw-alias-state-success-primary, #1aa260);
  border-color: var(--dsw-alias-state-success-primary, #1aa260);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #1aa260) 15%, transparent);
}
.dsh-git-author {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 90px;
}
.dsh-git-date {
  white-space: nowrap;
  opacity: 0.85;
}
.dsh-git-meta-divider {
  opacity: 0.4;
}
.dsh-git-tree-load-more {
  display: flex;
  align-items: center;
  position: relative;
  padding: 4px 10px 4px 6px;
  margin-top: 2px;
}
.dsh-git-load-more-btn {
  flex: 1;
  height: 26px;
  border: 1px dashed var(--dsw-alias-border-l2, rgba(118,137,166,.3));
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #6f7f9b);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.dsh-git-load-more-btn:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(100,120,150,.08));
  color: var(--dsw-alias-label-primary, inherit);
  border-style: solid;
  border-color: var(--dsw-alias-brand-primary, #4b70e2);
}
.dsh-git-load-more-btn:disabled {
  opacity: 0.6;
  cursor: wait;
}
.dsh-git-tree-end {
  text-align: center;
  padding: 12px 10px 4px;
  font-size: 10.5px;
  color: var(--dsw-alias-label-tertiary, #8c9ba5);
  opacity: 0.7;
}

/* ── Diff Pane & Views ── */
.dsh-git-diff-pane {
  flex: 1 1 50%;
  min-height: 140px;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--dsw-alias-border-l2, rgba(118,137,166,.25));
  background: var(--dsw-alias-bg-base, #ffffff);
  overflow: hidden;
}
.dsh-git-diff-header {
  height: 32px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(118,137,166,.18));
}
.dsh-git-diff-title {
  font-weight: 600;
  font-size: 11.5px;
  color: var(--dsw-alias-label-primary, inherit);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-git-diff-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.dsh-git-layout-switch {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(118,137,166,.25));
  border-radius: 6px;
  background: transparent;
}
.dsh-git-layout-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 6px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #94a3b8);
  font-size: 11px;
  cursor: pointer;
  outline: none;
  transition: background 0.12s ease, color 0.12s ease;
}
.dsh-git-layout-btn:hover {
  color: var(--dsw-alias-label-primary, inherit);
  background: var(--dsw-alias-interactive-bg-hover, rgba(100,120,150,.1));
}
.dsh-git-layout-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-interactive-bg-hover-accent, var(--dsw-alias-brand-primary, #4b70e2));
  outline-offset: -1px;
}
.dsh-git-layout-btn[data-active='true'] {
  background: var(--dsw-alias-interactive-bg-active, rgba(75,112,226,.22));
  color: var(--dsw-alias-label-primary, inherit);
  font-weight: 600;
  box-shadow: none;
}

/* ── Multi-file Collapsible Document ── */
.dsh-git-multifile-root {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.dsh-git-multifile-header {
  flex: none;
  padding: 5px 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary, #6f7f9b);
  background: var(--dsw-alias-interactive-bg-hover, rgba(100,120,150,.06));
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(118,137,166,.18));
}
.dsh-git-multifile-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.dsh-git-file-block {
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(118,137,166,.14));
}
.dsh-git-file-block-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: inherit;
  font-size: 11.5px;
  transition: background 0.12s ease;
}
.dsh-git-file-block-trigger:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(100,120,150,.08));
}
.dsh-git-file-block-name {
  flex: 1;
  min-width: 0;
  font-family: var(--ds-font-family-code, monospace);
  font-size: 11px;
  color: var(--dsw-alias-label-primary, inherit);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-git-file-block-stats {
  display: flex;
  gap: 6px;
  font-size: 10px;
  font-family: var(--ds-font-family-code, monospace);
}
.dsh-git-stat-add {
  color: var(--dsw-alias-state-success-primary, #1aa260);
  font-weight: 600;
}
.dsh-git-stat-del {
  color: var(--dsw-alias-state-error-primary, #e34c59);
  font-weight: 600;
}
.dsh-git-file-block-content {
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(118,137,166,.15));
  background: var(--dsw-alias-bg-base, inherit);
  max-height: 380px;
  overflow: auto;
}

/* ── Code Diff Renderer ── */
.dsh-git-diff-code-wrap {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.dsh-git-diff-code {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 6px 0;
  overflow: auto;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace);
  font-size: 11px;
  line-height: 1.55;
  color: var(--dsw-alias-label-primary, inherit);
  background: var(--dsw-alias-bg-base, inherit);
}
.dsh-git-diff-line {
  display: flex;
  align-items: flex-start;
  padding: 0 8px 0 0;
}
.dsh-git-diff-lineno {
  flex: none;
  width: 36px;
  text-align: right;
  padding-right: 8px;
  user-select: none;
  color: var(--dsw-alias-label-tertiary, #8c9ba5);
  border-right: 1px solid var(--dsw-alias-border-l1, rgba(118,137,166,.15));
}
.dsh-git-diff-sign {
  flex: none;
  width: 14px;
  text-align: center;
  font-weight: 700;
  user-select: none;
}
.dsh-git-diff-text {
  flex: 1;
  min-width: 0;
}

/* Diff line tints */
.dsh-git-diff-line[data-kind='add'] {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #1aa260) 10%, transparent);
  color: var(--dsw-alias-state-success-primary, #1aa260);
}
.dsh-git-diff-line[data-kind='del'] {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e34c59) 10%, transparent);
  color: var(--dsw-alias-state-error-primary, #e34c59);
}
.dsh-git-diff-line[data-kind='hunk'] {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #3b82f6) 10%, transparent);
  color: var(--dsw-alias-state-business-primary, #3b82f6);
  font-style: italic;
}
.dsh-git-diff-line[data-kind='file'] {
  font-weight: 700;
  color: var(--dsw-alias-label-secondary, #6f7f9b);
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(118,137,166,.15));
}

/* Split Diff View */
.dsh-git-split-root {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace);
  font-size: 11px;
}
.dsh-git-split-labels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  flex: none;
  padding: 4px 8px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(100,120,150,.06));
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(118,137,166,.18));
  color: var(--dsw-alias-label-tertiary, #8c9ba5);
  font-size: 10px;
  font-weight: 600;
  text-align: center;
}
.dsh-git-split-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.dsh-git-split-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  width: 100%;
}
.dsh-git-split-cell {
  display: flex;
  align-items: flex-start;
  min-height: 18px;
  border-right: 1px solid var(--dsw-alias-border-l1, rgba(118,137,166,.15));
  line-height: 1.5;
}
.dsh-git-split-no {
  flex: none;
  width: 30px;
  text-align: right;
  padding-right: 6px;
  color: var(--dsw-alias-label-tertiary, #8c9ba5);
  user-select: none;
}
.dsh-git-split-text {
  flex: 1;
  min-width: 0;
  padding: 0 4px;
}
.dsh-git-split-cell[data-tone='add'] {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #1aa260) 10%, transparent);
  color: var(--dsw-alias-state-success-primary, #1aa260);
}
.dsh-git-split-cell[data-tone='del'] {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e34c59) 10%, transparent);
  color: var(--dsw-alias-state-error-primary, #e34c59);
}
.dsh-git-split-header {
  padding: 3px 8px;
  font-style: italic;
  color: var(--dsw-alias-state-business-primary, #3b82f6);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #3b82f6) 8%, transparent);
}

.dsh-git-overflow-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #8c9ba5);
  background: var(--dsw-alias-interactive-bg-hover, rgba(100,120,150,.08));
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(118,137,166,.15));
}

/* ── Feedback & Placeholders ── */
.dsh-git-centered {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 180px;
  padding: 32px 16px;
  box-sizing: border-box;
  color: var(--dsw-alias-label-secondary, #6f7f9b);
  text-align: center;
  margin: auto;
}
.dsh-git-spinner {
  width: 24px;
  height: 24px;
  border: 2.5px solid var(--dsw-alias-border-l2, rgba(118,137,166,.25));
  border-top-color: var(--dsw-alias-brand-primary, #4b70e2);
  border-radius: 50%;
  animation: dsh-git-spin 0.75s linear infinite;
  margin-bottom: 10px;
  flex-shrink: 0;
}
@keyframes dsh-git-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.dsh-git-loading-text {
  font-size: 12px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary, #6f7f9b);
  letter-spacing: 0.2px;
}
.dsh-git-loading-box {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 180px;
  padding: 24px;
  box-sizing: border-box;
  margin: auto;
  gap: 12px;
}
.dsh-git-empty {
  margin: auto;
  max-width: 280px;
  padding: 30px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.dsh-git-empty-icon {
  color: var(--dsw-alias-label-tertiary, #8c9ba5);
  margin-bottom: 8px;
}
.dsh-git-empty-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--dsw-alias-label-primary, inherit);
  margin-bottom: 4px;
}
.dsh-git-empty-detail {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #8c9ba5);
  line-height: 1.5;
}
.dsh-git-notice {
  margin: 8px 12px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 11px;
  color: var(--dsw-alias-state-warn-primary, #d97706);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #d97706) 12%, transparent);
}
.dsh-git-banner-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  font-size: 11.5px;
  color: var(--dsw-alias-state-error-primary, #e34c59);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e34c59) 10%, transparent);
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(118,137,166,.2));
}
.dsh-git-banner-text {
  flex: 1;
  min-width: 0;
}
.dsh-git-banner-close {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 2px;
  display: flex;
}

/* ── Modal Dialog ── */
.dsh-git-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
}
.dsh-git-modal-card {
  box-sizing: border-box;
  width: min(380px, 100%);
  padding: 20px;
  background: var(--dsw-alias-container-bg, var(--dsw-alias-bg-base, #ffffff));
  border: 1px solid var(--dsw-alias-border-l2, rgba(118,137,166,.25));
  border-radius: 12px;
  box-shadow: 0 12px 36px rgba(0,0,0,.22);
  text-align: center;
}
.dsh-git-modal-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  margin: 0 auto 10px;
  border-radius: 99px;
  font-weight: 800;
  font-size: 18px;
  color: var(--dsw-alias-state-error-primary, #e34c59);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e34c59) 14%, transparent);
}
.dsh-git-modal-title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-git-modal-desc {
  margin: 0 0 18px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #6f7f9b);
  line-height: 1.5;
}
.dsh-git-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.dsh-git-btn-secondary {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(118,137,166,.25));
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  font-size: 12px;
  cursor: pointer;
}
.dsh-git-btn-secondary:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(100,120,150,.08));
}
.dsh-git-btn-danger {
  height: 28px;
  padding: 0 12px;
  border: none;
  border-radius: 6px;
  background: var(--dsw-alias-state-error-primary, #e34c59);
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.dsh-git-btn-danger:hover {
  filter: brightness(1.08);
}

/* ── Header Right & Sync Styles ── */
.dsh-git-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dsh-git-sync-wrap {
  position: relative;
}
.dsh-git-sync-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(100,120,150,.1));
}
.dsh-git-sync-ahead {
  color: var(--dsw-alias-brand-primary, #4b70e2);
}
.dsh-git-sync-behind {
  color: var(--dsw-alias-state-warn-primary, #d97706);
}
.dsh-git-sync-even {
  color: var(--dsw-alias-state-success-primary, #10b981);
  font-size: 10px;
}
.dsh-git-sync-no-upstream {
  color: var(--dsw-alias-label-tertiary, #8c9ba5);
  font-size: 10px;
}
.dsh-git-sync-menu,
.dsh-git-stash-menu {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 1000;
  margin-top: 4px;
  min-width: 190px;
  background: var(--dsw-alias-container-bg, var(--dsw-alias-bg-base, #ffffff));
  border: 1px solid var(--dsw-alias-border-l2, rgba(118,137,166,.25));
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,.15);
  padding: 4px;
}
.dsh-git-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  background: transparent;
  border-radius: 4px;
  color: var(--dsw-alias-label-primary, inherit);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.dsh-git-menu-item:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(100,120,150,.1));
}
.dsh-git-menu-divider {
  height: 1px;
  margin: 4px 0;
  background: var(--dsw-alias-border-l1, rgba(118,137,166,.18));
}

/* ── Branch Creation inside Dropdown ── */
.dsh-git-branch-create-box {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(118,137,166,.15));
  margin-bottom: 4px;
}
.dsh-git-input-sm {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(118,137,166,.25));
  border-radius: 4px;
  background: var(--dsw-alias-bg-base, #ffffff);
  color: inherit;
  font-size: 11.5px;
  outline: none;
}
.dsh-git-input-sm:focus {
  border-color: var(--dsw-alias-brand-primary, #4b70e2);
}
.dsh-git-btn-sm {
  flex: none;
  height: 24px;
  padding: 0 8px;
  border: none;
  border-radius: 4px;
  background: var(--dsw-alias-brand-primary, #4b70e2);
  color: #ffffff;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
}
.dsh-git-btn-sm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Tabs Bar & Toolbar Actions ── */
.dsh-git-tabs-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(118,137,166,.18));
  padding-right: 8px;
}
.dsh-git-tabs-bar .dsh-git-tabs {
  border-bottom: none;
}
.dsh-git-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* ── Stash Styles ── */
.dsh-git-stash-wrap {
  position: relative;
}
.dsh-git-dot-badge {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--dsw-alias-brand-primary, #4b70e2);
}
.dsh-git-stash-list-hint {
  font-size: 10.5px;
  color: var(--dsw-alias-label-tertiary, #8c9ba5);
  padding: 4px 8px 2px;
}
.dsh-git-stash-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 8px;
  font-size: 11px;
}
.dsh-git-stash-row:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(100,120,150,.08));
  border-radius: 4px;
}
.dsh-git-stash-msg {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-git-btn-link {
  border: none;
  background: transparent;
  color: var(--dsw-alias-brand-primary, #4b70e2);
  font-size: 11px;
  cursor: pointer;
  padding: 0;
}
.dsh-git-btn-link:hover {
  text-decoration: underline;
}
.dsh-git-input-modal {
  box-sizing: border-box;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  margin-bottom: 16px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(118,137,166,.3));
  border-radius: 6px;
  background: var(--dsw-alias-bg-base, #ffffff);
  color: inherit;
  font-size: 12px;
  outline: none;
}
.dsh-git-input-modal:focus {
  border-color: var(--dsw-alias-brand-primary, #4b70e2);
}

/* ── Tree View Styles ── */
.dsh-git-tree-dir-block {
  display: flex;
  flex-direction: column;
}
.dsh-git-tree-dir-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding-right: 8px;
  cursor: pointer;
  user-select: none;
  color: var(--dsw-alias-label-secondary, #6f7f9b);
  transition: background 0.12s ease;
}
.dsh-git-tree-dir-row:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(100,120,150,.08));
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-git-tree-folder-icon {
  display: flex;
  color: var(--dsw-alias-brand-primary, #4b70e2);
  opacity: 0.85;
}
.dsh-git-tree-folder-name {
  flex: 1;
  min-width: 0;
  font-weight: 500;
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-git-tree-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 0 5px;
  border-radius: 99px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(100,120,150,.1));
  color: var(--dsw-alias-label-tertiary, #8c9ba5);
}
.dsh-git-tree-file-row {
  box-sizing: border-box;
}

/* ── Hunk Staging Button in Diff ── */
.dsh-git-diff-line {
  position: relative;
}
.dsh-git-diff-line:hover .dsh-git-hunk-btn {
  opacity: 1;
}
.dsh-git-hunk-btn {
  margin-left: auto;
  margin-right: 8px;
  height: 18px;
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(118,137,166,.3));
  border-radius: 3px;
  background: var(--dsw-alias-container-bg, var(--dsw-alias-bg-base, #ffffff));
  color: var(--dsw-alias-brand-primary, #4b70e2);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  opacity: 0.85;
  transition: all 0.12s ease;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
}
.dsh-git-hunk-btn:hover:not(:disabled) {
  opacity: 1;
  background: var(--dsw-alias-interactive-bg-hover, rgba(75,112,226,.1));
  border-color: var(--dsw-alias-brand-primary, #4b70e2);
}
.dsh-git-hunk-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── Animation ── */
@keyframes dsh-git-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.is-spinning svg {
  animation: dsh-git-spin 1s linear infinite;
}
`}</style>
  )
}
