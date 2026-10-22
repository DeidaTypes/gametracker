import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  plugins: [react()],
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
