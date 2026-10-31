import './style.css';
import { GameUI } from './ui';
import { GameEngine } from './game/engine';
import { saveResult } from './game/storage';

let engine: GameEngine | undefined;
const ui = new GameUI({
  onStart: (vehicleId, nickname) => engine?.start(vehicleId, nickname),
  onPause: () => engine?.pause(),
  onResume: () => engine?.resume(),
  onRestart: () => engine?.restart(),
  onLeave: () => engine?.leave(),
  onSound: muted => engine?.setMuted(muted),
});

async function boot() {
  try {
    engine = new GameEngine(snapshot => ui.update(snapshot), result => { saveResult(result); ui.showResult(result) });
    await engine.init();
    ui.setReady();
  } catch (error) {
    console.error('游戏启动失败', error);
    ui.showError(error instanceof Error ? `游戏启动失败：${error.message}` : '游戏启动失败，请刷新重试');
  }
}

void boot();
