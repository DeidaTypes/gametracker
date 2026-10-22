import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// Version shown in Settings -> Help & about comes from package.json. It is
// injected here (not imported in the app) so the whole manifest, dependency
// list included, is not bundled just to read one field.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig(({ command }) => ({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version || ''),
  },
  server: {
    host: true, // Allow access from network (for mobile testing)
    port: 5173,
  },
  // Production builds strip console.log / console.debug; console.warn and
  // console.error stay. Dev keeps all logging.
  esbuild: command === 'build' ? { pure: ['console.log', 'console.debug'] } : {},
  build: {
    // Ensure compatibility with older browsers (iOS 15+, Android 24+)
    target: ['es2015', 'safari12', 'ios12'],
    cssTarget: 'safari12',
  },
}))
