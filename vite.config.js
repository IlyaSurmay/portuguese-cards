import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'offline-shell',
      apply: 'build',
      generateBundle(_options, bundle) {
        const template = readFileSync(new URL('./src/service-worker.js', import.meta.url), 'utf8')
        const assets = [
          '/index.html', '/manifest.webmanifest', '/icons/icon.svg',
          '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png',
          ...Object.keys(bundle).filter(name => !name.endsWith('.map')).map(name => `/${name}`),
        ]
        const hash = createHash('sha256').update(template + JSON.stringify(assets))
        hash.update(readFileSync(new URL('./index.html', import.meta.url)))
        for (const path of assets.filter(path => !path.startsWith('/assets/') && path !== '/index.html')) {
          hash.update(readFileSync(new URL(`./public${path}`, import.meta.url)))
        }
        const version = hash.digest('hex').slice(0, 12)
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: template
          .replaceAll('__BUILD__', version)
          .replace('/* inject:precache */ []', JSON.stringify(assets)) })
      },
    },
  ],
})
