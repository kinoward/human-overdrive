import './style.css';
import { GameUI } from './ui';
import { GameEngine } from './game/engine';
import { saveResult } from './game/storage';
import { MusicController } from './game/music';

let engine: GameEngine | undefined;
const music = new MusicController();
const ui = new GameUI({
  onStart: (vehicleId, nickname) => { music.startRace(); engine?.start(vehicleId, nickname) },
  onPause: () => engine?.pause(),
  onResume: () => engine?.resume(),
  onRestart: () => { music.startRace(); engine?.restart() },
  onLeave: () => { engine?.leave(); music.showMenu() },
  onSound: muted => { engine?.setMuted(muted); music.setMuted(muted) },
});

async function boot() {
  try {
    engine = new GameEngine(snapshot => { music.update(snapshot); ui.update(snapshot) }, result => { music.finish(result.outcome); saveResult(result); ui.showResult(result) });
    await engine.init();
    ui.setReady();
  } catch (error) {
    console.error('游戏启动失败', error);
    ui.showError(error instanceof Error ? `游戏启动失败：${error.message}` : '游戏启动失败，请刷新重试');
  }
}

void boot();
