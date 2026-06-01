import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const thisDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(thisDir, '..')
const projectRoot = resolve(frontendDir, '..')

const distDir = resolve(projectRoot, 'dist')
const distIndexPath = resolve(distDir, 'index.html')
const distAssetsDir = resolve(distDir, 'assets')

const rootIndexPath = resolve(projectRoot, 'index.html')
const rootAssetsDir = resolve(projectRoot, 'assets')

await cp(distIndexPath, rootIndexPath)

await rm(rootAssetsDir, { recursive: true, force: true })
await mkdir(rootAssetsDir, { recursive: true })
await cp(distAssetsDir, rootAssetsDir, { recursive: true })

console.log('Synced dist/index.html -> index.html and dist/assets -> assets/')
