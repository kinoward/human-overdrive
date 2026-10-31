export class GameAudio {
  private context?: AudioContext;
  private oscillator?: OscillatorNode;
  private gain?: GainNode;
  private master?: GainNode;
  private muted = false;

  start() {
    if (!this.context) {
      this.context = new AudioContext();
      this.oscillator = this.context.createOscillator();
      this.gain = this.context.createGain();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.context.destination);
      this.oscillator.type = 'triangle';
      this.oscillator.connect(this.gain).connect(this.master);
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

  setMuted(value: boolean) {
    this.muted = value;
    if (this.context && this.master) this.master.gain.setValueAtTime(value ? 0 : 1, this.context.currentTime);
  }

  impact(strength: number) {
    if (!this.context || this.muted) return;
    const now = this.context.currentTime;
    const duration = 0.08 + strength * 0.12;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(85 + strength * 45, now);
    oscillator.frequency.exponentialRampToValueAtTime(28, now + duration);
    gain.gain.setValueAtTime(0.018 + strength * 0.065, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain).connect(this.master!);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() };
    oscillator.start(now);
    oscillator.stop(now + duration);
  }
}
