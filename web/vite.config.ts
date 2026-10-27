import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { extname, join } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const PREVIEW_TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript' }

/** In development, pages preview from preview/ on a second port: they must run on an origin that is
 * not the app's. Its two files are served as they are, as in production; no second Vite, whose
 * optimizer would share and spoil the app's. */
const previewOrigin = (): Plugin => ({
  name: 'isbell-preview-origin',
  // Not under Vitest, which serves too.
  apply: (_, { command, mode }) => command === 'serve' && mode !== 'test',
  configureServer() {
    // Once per process: a restart builds the new app server before closing the old one.
    const held = globalThis as { isbellPreview?: Server }
    held.isbellPreview ??= createServer(async (req, res) => {
      const path = new URL(req.url ?? '/', 'http://preview').pathname
      const type = PREVIEW_TYPES[extname(path)]
      const file =
        type && !path.includes('..')
          ? await readFile(join('preview', path)).catch((err: NodeJS.ErrnoException) => {
              if (err.code !== 'ENOENT') console.error('the preview origin could not read', path, err)
              return null
            })
          : null
      res.writeHead(file ? 200 : 404, { 'content-type': type ?? 'text/plain', 'cache-control': 'no-cache' })
      res.end(file ?? 'Not found')
    }).listen(5174)
  },
})

// biome-ignore lint/style/noDefaultExport: Vite reads the default export.
export default defineConfig({ plugins: [react(), tailwindcss(), previewOrigin()] })
