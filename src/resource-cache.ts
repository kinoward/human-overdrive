export async function prepareResourceCache() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
      updateViaCache: 'none',
    });
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>(resolve => {
      const finish = () => {
        window.clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener('controllerchange', finish);
        resolve();
      };
      const timeout = window.setTimeout(finish, 5000);
      navigator.serviceWorker.addEventListener('controllerchange', finish);
      if (navigator.serviceWorker.controller) finish();
    });
  } catch (error) {
    console.warn('资源缓存暂不可用，将直接加载游戏', error);
  }
}
