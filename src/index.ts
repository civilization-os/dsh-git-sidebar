/**
 * dsh-git-sidebar — host half (Node).
 *
 * This scaffold is a *pure client* consumer of the `ctx.betterSidebar`
 * service provided by dsh-better-sidebar, so the Node half is intentionally
 * empty. The entry must still exist: profile boot mounts the package and the
 * client half (exports["./client"]) is only served for mounted entries.
 *
 * If your plugin needs host-side capability (routes, WebSockets, tools,
 * settings schema …) implement it here — dsh-better-sidebar itself is the
 * reference (src/index.ts of the DSH-better-sidebar repo).
 */
export const name = 'dsh-git-sidebar'

export function apply(): void {
  // Host Git routes are implemented in the next milestone.
}
