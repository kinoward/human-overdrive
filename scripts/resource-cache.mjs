import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function resourceCache() {
  const publicDirectory = new URL('../public/', import.meta.url);
  const files = await readdir(publicDirectory, { recursive: true, withFileTypes: true });
  const versions = Object.fromEntries(await Promise.all(files
    .filter(file => file.isFile())
    .map(async file => {
      const filename = `${file.parentPath}/${file.name}`;
      const path = filename.slice(fileURLToPath(publicDirectory).length);
      const bytes = await readFile(filename);
      return [path, createHash('sha256').update(bytes).digest('hex').slice(0, 16)];
    })));

  function versionUrls(source) {
    return source.replace(/(["'(])\/((?:assets|data)\/[^"'()\s<>?]+)(?=["')])/g, (match, quote, path) => {
      if (!versions[path]) throw new Error(`静态资源不存在：${path}`);
      return `${quote}/${path}?v=${versions[path]}`;
    });
  }

  return {
    define: { __ASSET_VERSIONS__: JSON.stringify(versions) },
    css: {
      postcss: {
        plugins: [{
          postcssPlugin: 'resource-versions',
          Declaration(declaration) {
            declaration.value = versionUrls(declaration.value);
          },
        }],
      },
    },
    plugins: [{
      name: 'resource-cache',
      transformIndexHtml: { order: 'pre', handler: versionUrls },
      async generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'sw.js',
          source: await readFile(new URL('./resource-worker.js', import.meta.url), 'utf8'),
        });
      },
    }],
  };
}
