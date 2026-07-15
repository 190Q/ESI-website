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
try {
  await rm(rootAssetsDir, { recursive: true, force: true })
} catch (error) {
  const code = error && typeof error === 'object' ? error.code : null
  if (code !== 'EPERM' && code !== 'EACCES') throw error
  console.warn(
    `Could not fully remove assets directory (${code}); continuing with additive sync.`
  )
}
await mkdir(rootAssetsDir, { recursive: true })
await cp(distAssetsDir, rootAssetsDir, {
  recursive: true,
  force: false,
  errorOnExist: false,
})

console.log('Synced dist/index.html -> index.html and dist/assets -> assets/')
