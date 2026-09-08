/**
 * Standalone tsdown config for the dsh-git-sidebar external plugin.
 *
 * Two outputs (community-standard shape, e.g. dsh-sentinel / dsh-focus-chat):
 *  - node half   : plain ESM for the host Loader (lib/index.js)
 *  - browser half: ONE CJS closure whose externals are exactly the platform
 *                   seed modules, wrapped in window.__ModuleLoader__.load(...)
 *                   (lib/client.js)
 *
 * Only type-only imports of `dsh-better-sidebar` / `@deepseek-ai/cordis` are
 * allowed in src/client (they are erased at build time → zero runtime
 * coupling); any real runtime import must be a platform seed module.
 */
import type { UserConfig } from 'tsdown'

const PLUGIN_ID = 'dsh-git-sidebar'

/** Modules the DSH browser shell already provides (frozen platform seed table). */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
] as const

export default [
  {
    name: `${PLUGIN_ID}/node`,
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    name: `${PLUGIN_ID}/client`,
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...PLATFORM_MODULES],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    noExternal: (id: string) => (PLATFORM_MODULES.includes(id) ? undefined : true),
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
] satisfies UserConfig[]
