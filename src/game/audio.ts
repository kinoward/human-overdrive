export class GameAudio {
  private context?: AudioContext;
  private oscillator?: OscillatorNode;
  private gain?: GainNode;
  private muted = false;

  start() {
    if (!this.context) {
      this.context = new AudioContext();
      this.oscillator = this.context.createOscillator();
      this.gain = this.context.createGain();
      this.oscillator.type = 'triangle';
      this.oscillator.connect(this.gain).connect(this.context.destination);
      this.gain.gain.value = 0;
      this.oscillator.start();
    }
    void this.context.resume();
  }

  update(speed: number, warning: number, running: boolean) {
    if (!this.context || !this.oscillator || !this.gain) return;
    const now = this.context.currentTime;
    this.oscillator.frequency.setTargetAtTime(35 + speed * 1.6 + (warning > 0 ? Math.sin(now * 4) * 8 : 0), now, 0.12);
    this.gain.gain.setTargetAtTime(!this.muted && running ? 0.018 + speed * 0.00013 : 0, now, 0.1);
  }

  setMuted(value: boolean) { this.muted = value }
}
