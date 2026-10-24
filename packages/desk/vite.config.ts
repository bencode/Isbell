import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// biome-ignore lint/style/noDefaultExport: Vite reads the default export.
export default defineConfig({ plugins: [react(), tailwindcss()] })
