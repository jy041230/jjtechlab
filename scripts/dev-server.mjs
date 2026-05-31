import { createServer } from 'vite'
import config from '../vite.config.js'

const server = await createServer({
  ...config,
  configFile: false,
  root: process.cwd(),
  server: {
    ...(config.server || {}),
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
  },
})

await server.listen()
server.printUrls()

setInterval(() => {}, 1000)
