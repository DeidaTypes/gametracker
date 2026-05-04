import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Allow access from network (for mobile testing)
    port: 5173,
    proxy: {
      '/api/igdb': {
        target: 'https://api.igdb.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/igdb/, ''),
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            if (req.headers['client-id']) {
              proxyReq.setHeader('Client-ID', req.headers['client-id'])
            }
            if (req.headers['authorization']) {
              proxyReq.setHeader('Authorization', req.headers['authorization'])
            }
          })
          proxy.on('proxyRes', (proxyRes, _req, _res) => {
            proxyRes.headers['cache-control'] = 'public, s-maxage=3600, stale-while-revalidate=86400'
          })
        },
      },
      '/api/twitch': {
        target: 'https://id.twitch.tv',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/twitch/, ''),
      },
    },
  },
  build: {
    // Ensure compatibility with older browsers (iOS 15+, Android 24+)
    target: ['es2015', 'safari12', 'ios12'],
    cssTarget: 'safari12',
  },
})

