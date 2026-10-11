import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig, type Connect, type Plugin } from 'vite';
import { nodeHandler } from './server/http.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const mediapipeVersion: string = JSON.parse(
  readFileSync(new URL('./node_modules/@mediapipe/tasks-vision/package.json', import.meta.url), 'utf8'),
).version;

/** Serves /api/* from server/ in `vite` and `vite preview`, mirroring the Vercel function. */
function devApi(): Plugin {
  const middleware: Connect.NextHandleFunction = (req: IncomingMessage, res: ServerResponse, next) => {
    const url = req.url ?? '/';
    const path = url.split('?')[0];
    if (path.startsWith('/api/')) {
      void nodeHandler(req, res);
      return;
    }
    if (path === '/tv' || path === '/phone') {
      res.statusCode = 302;
      res.setHeader('Location', path + '/' + url.slice(path.length));
      res.end();
      return;
    }
    next();
  };
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [devApi(), ...(mode === 'lan' ? [basicSsl()] : [])],
  define: {
    __MEDIAPIPE_VERSION__: JSON.stringify(mediapipeVersion),
  },
  build: {
    // Samsung TV browsers run old Chromium engines; keep syntax conservative.
    target: ['chrome69', 'safari15'],
    rolldownOptions: {
      input: {
        main: root + 'index.html',
        tv: root + 'tv/index.html',
        phone: root + 'phone/index.html',
      },
    },
  },
}));
