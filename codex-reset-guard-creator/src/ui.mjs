import { readFile } from 'node:fs/promises';
import { VERSION } from './version.mjs';
export const uiUri = `ui://reset-guard-creator/dashboard-${VERSION}.html`;
export async function dashboardResource() {
  const [html, css, js] = await Promise.all([
    readFile(new URL('../ui/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../ui/style.css', import.meta.url), 'utf8'),
    readFile(new URL('../ui/bundle.js', import.meta.url), 'utf8'),
  ]);
  return { contents: [{ uri: uiUri, mimeType: 'text/html;profile=mcp-app',
    text: html.replace('/*STYLE*/', () => css).replace('/*SCRIPT*/', () => js.replace(/<\/script/gi, '<\\/script')),
    _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
      'openai/ui': { preferredDisplayMode: 'fullscreen', availableDisplayModes: ['inline', 'fullscreen'] } },
  }] };
}
