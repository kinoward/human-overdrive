import { defineConfig } from 'vite';
import { resourceCache } from './scripts/resource-cache.mjs';

export default defineConfig(async ({ command }) => {
  if (command !== 'build') return {};
  return resourceCache();
});
