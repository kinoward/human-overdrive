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
  onSkipCinematic: () => engine?.skipCinematic(),
  onLeave: () => { engine?.leave(); music.showMenu() },
  onSound: muted => { engine?.setMuted(muted); music.setMuted(muted) },
});

export async function boot(onProgress: (progress: number, message: string) => Promise<void>) {
  await onProgress(0.02, '准备驾驶环境');
  engine = new GameEngine(snapshot => { music.update(snapshot); ui.update(snapshot) }, result => ui.showResult(result), result => saveResult(result));
  await engine.init(onProgress);
  ui.setReady();
}
