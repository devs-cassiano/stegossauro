import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';

  // DEV: HMR/WebSocket do Vite. BUILD/Amplify: connect-src none (rede bloqueada).
  // worker-src necessário para stego.worker empacotado em dist/assets/.
  // Em produção o Amplify também aplica CSP via customHttp.yml (borda CloudFront).
  const cspContent = isDev
    ? "default-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* http://localhost:*; img-src 'self' blob: data:; object-src 'none'; worker-src 'self' blob:;"
    : "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'none'; object-src 'none'; frame-ancestors 'none'; worker-src 'self' blob:; child-src 'self' blob:; form-action 'none'; base-uri 'none';";

  return {
    // '/' é o padrão correto para Amplify Hosting na raiz do domínio.
    // Assets em dist/assets/* resolvem como /assets/... no CloudFront.
    base: '/',
    plugins: [
      {
        name: 'dynamic-csp',
        transformIndexHtml(html) {
          return html.replace(
            '<head>',
            `<head>\n    <meta http-equiv="Content-Security-Policy" content="${cspContent}">`,
          );
        },
      },
    ],
    build: {
      target: 'es2022',
      sourcemap: false,
      assetsInlineLimit: 0,
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: false,
          passes: 2,
          pure_getters: true,
        },
        mangle: {
          toplevel: true,
        },
        format: {
          comments: false,
        },
      },
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
    worker: {
      format: 'es',
    },
    esbuild:
      mode === 'production'
        ? {
            drop: ['console'],
            legalComments: 'none',
          }
        : undefined,
    server: {
      headers: {
        'Content-Security-Policy': cspContent,
      },
    },
    preview: {
      headers: {
        'Content-Security-Policy': cspContent,
      },
    },
  };
});
