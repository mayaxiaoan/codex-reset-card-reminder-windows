import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
await build({ entryPoints: [fileURLToPath(new URL('./src/mcp-entry.mjs', import.meta.url))],
  outfile: fileURLToPath(new URL('./src/mcp.mjs', import.meta.url)), bundle: true, minify: true,
  platform: 'node', format: 'esm', target: 'node22', legalComments: 'eof',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});
