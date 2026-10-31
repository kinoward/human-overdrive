import { prepareResourceCache } from './resource-cache';

const screen = document.querySelector<HTMLElement>('#loading-screen')!;
const message = document.querySelector<HTMLElement>('#loading-message')!;
const value = document.querySelector<HTMLElement>('#loading-value')!;
const progress = document.querySelector<HTMLElement>('#loading-progress')!;
const fill = progress.querySelector<HTMLElement>('span')!;
const retry = document.querySelector<HTMLButtonElement>('#loading-retry')!;

retry.addEventListener('click', () => window.location.reload());

async function showProgress(fraction: number, label: string) {
  if (screen.classList.contains('is-failed')) return;
  const percent = Math.floor(fraction * 100);
  message.textContent = label;
  value.textContent = `${percent}%`;
  progress.classList.remove('is-indeterminate');
  progress.setAttribute('aria-valuenow', String(percent));
  progress.setAttribute('aria-valuetext', `${percent}% · ${label}`);
  fill.style.width = `${percent}%`;
  if (!document.hidden) await new Promise<void>(resolve => window.setTimeout(resolve, 16));
}

function showLoading(loading: boolean) {
  screen.hidden = !loading;
  document.querySelector<HTMLElement>('#scene')!.inert = loading;
  const app = document.querySelector<HTMLElement>('#app')!;
  app.inert = loading;
  app.setAttribute('aria-busy', String(loading));
}

function showError(error: unknown) {
  console.error('游戏启动失败', error);
  showLoading(true);
  screen.classList.add('is-failed');
  document.querySelector<HTMLElement>('#loading-title')!.textContent = '暂时无法出发';
  message.setAttribute('role', 'alert');
  message.textContent = '游戏准备未能完成，请重新载入后再试。';
  retry.hidden = false;
}

async function start() {
  try {
    const cacheReady = prepareResourceCache();
    const { boot } = await import('./main');
    boot({ onProgress: showProgress, onLoading: showLoading, onError: showError, cacheReady });
  } catch (error) {
    showError(error);
  }
}

void start();
