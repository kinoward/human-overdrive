export function assetUrl(path: string): string {
  const url = `${import.meta.env.BASE_URL}${path}`;
  if (!import.meta.env.PROD) return url;
  const version = __ASSET_VERSIONS__[path];
  if (!version) throw new Error(`资源版本缺失：${path}`);
  return `${url}?v=${version}`;
}
