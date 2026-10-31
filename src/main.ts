import './style.css';
import { GameUI } from './ui';
import type { GameEngine } from './game/engine';
import { saveResult } from './game/storage';
import { MusicController } from './game/music';

interface BootOptions {
  onProgress: (progress: number, message: string) => Promise<void>;
  onLoading: (loading: boolean) => void;
  onError: (error: unknown) => void;
  cacheReady: Promise<void>;
}

export function boot({ onProgress, onLoading, onError, cacheReady }: BootOptions) {
  let engine: GameEngine | undefined;
  let engineReady: Promise<void> | undefined;
  let ready = false;
  let muted = false;
  const music = new MusicController();
  const prepareEngine = () => engineReady ??= (async () => {
    await cacheReady;
    await onProgress(0.02, '准备驾驶环境');
    const { GameEngine } = await import('./game/engine');
    engine = new GameEngine(snapshot => { music.update(snapshot); ui.update(snapshot) }, result => ui.showResult(result), result => saveResult(result));
    await engine.init(onProgress);
    engine.setMuted(muted);
    ready = true;
    performance.mark('scene-ready');
    await onProgress(1, '准备完成');
  })();
  const ui = new GameUI({
    onStart: async (vehicleId, nickname) => {
      if (!ready) onLoading(true);
      try {
        await prepareEngine();
        onLoading(false);
        music.startRace();
        engine!.start(vehicleId, nickname);
      } catch (error) {
        onError(error);
      }
    },
    onPause: () => engine?.pause(),
    onResume: () => engine?.resume(),
    onRestart: () => { music.startRace(); engine?.restart() },
    onSkipCinematic: () => engine?.skipCinematic(),
    onLeave: () => { engine?.leave(); music.showMenu() },
    onSound: value => { muted = value; engine?.setMuted(value); music.setMuted(value) },
  });
  ui.setReady();
  onLoading(false);
  performance.mark('menu-ready');
  requestAnimationFrame(() => requestAnimationFrame(() => { void prepareEngine().catch(onError) }));
}
