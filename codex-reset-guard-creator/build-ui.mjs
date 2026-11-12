import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
await build({ entryPoints: [fileURLToPath(new URL('./ui/dashboard.js', import.meta.url))],
  outfile: fileURLToPath(new URL('./ui/bundle.js', import.meta.url)), bundle: true, minify: true,
  tsconfigRaw: {}, format: 'esm', platform: 'browser', target: ['es2022'], legalComments: 'eof' });
