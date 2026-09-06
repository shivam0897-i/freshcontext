import { build } from 'esbuild'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const dev = process.argv.includes('--dev')
const outDir = dev ? 'dist.dev' : 'dist'
await mkdir(outDir, { recursive: true })

const common = {
  bundle: true,
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  target: ['chrome120'],
  define: { __DEV__: JSON.stringify(dev) },
  logLevel: 'info',
}

// Content script must be a classic single-file script (IIFE) — no ES modules allowed.
await build({ ...common, entryPoints: ['src/content.ts'], format: 'iife', outfile: `${outDir}/content.js` })

// Service worker is declared with "type": "module" in the manifest.
await build({ ...common, entryPoints: ['src/background.ts'], format: 'esm', outfile: `${outDir}/background.js` })

// Side panel is a plain page loaded via <script src> (IIFE).
await build({ ...common, entryPoints: ['src/sidepanel/main.ts'], format: 'iife', outfile: `${outDir}/sidepanel.js` })

await cp('src/sidepanel/sidepanel.html', `${outDir}/sidepanel.html`)
if (existsSync('icons')) await cp('icons', `${outDir}/icons`, { recursive: true })

const manifestSrc = dev ? 'manifest.dev.json' : 'manifest.json'
const manifest = JSON.parse(await readFile(manifestSrc, 'utf8'))
if (!existsSync('icons')) {
  // Manifest stays valid without icons — drop icon references so load-unpacked never warns.
  delete manifest.icons
  delete manifest.action?.default_icon
}
await writeFile(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2))
console.log(`\nBuilt ${dev ? 'dev' : 'production'} extension → ${outDir}/`)
