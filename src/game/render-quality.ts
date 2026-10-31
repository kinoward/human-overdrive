import * as THREE from 'three';

export class RenderQuality {
  private frames: number[] = [];
  private work = 0;
  private warmup = 2;
  private gl: WebGL2RenderingContext;
  private timer: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private queries: WebGLQuery[] = [];
  private query: WebGLQuery | null = null;
  private gpuMs = 0;

  constructor(private renderer: THREE.WebGLRenderer, private onResize: (width: number, height: number, level: number) => void) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.timer = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }

  beginRender() {
    if (!this.timer) return;
    const gl = this.gl;
    while (this.queries.length && gl.getQueryParameter(this.queries[0], gl.QUERY_RESULT_AVAILABLE)) {
      const query = this.queries.shift()!;
      if (!gl.getParameter(this.timer.GPU_DISJOINT_EXT)) this.gpuMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(query);
    }
    if (this.queries.length >= 3) return;
    this.query = gl.createQuery();
    if (this.query) gl.beginQuery(this.timer.TIME_ELAPSED_EXT, this.query);
  }

  endRender() {
    if (!this.query) return;
    this.gl.endQuery(this.timer!.TIME_ELAPSED_EXT);
    this.queries.push(this.query);
    this.query = null;
  }

  resize(width: number, height: number) {
    const base = Math.min(window.devicePixelRatio, 1, 1600 / width, 900 / height);
    this.renderer.setPixelRatio(base);
    this.renderer.setSize(width, height);
    this.onResize(width, height, 0);
    this.renderer.domElement.dataset.quality = JSON.stringify({ targetFps: 60, level: 0, width: this.renderer.domElement.width, height: this.renderer.domElement.height });
  }

  reset() {
    this.frames.length = 0;
    this.work = 0;
    this.warmup = 2;
  }

  observe(delta: number, workMs: number) {
    if (delta <= 0) return;
    if (this.warmup > 0) { this.warmup -= delta; return }
    this.frames.push(delta * 1000);
    this.work += workMs;
    const elapsed = this.frames.reduce((sum, frame) => sum + frame, 0);
    if (elapsed < 1000) return;
    const average = elapsed / this.frames.length;
    this.frames.sort((a, b) => a - b);
    const p95 = this.frames[Math.floor((this.frames.length - 1) * 0.95)];
    this.renderer.domElement.dataset.frameBudget = JSON.stringify({ fps: Math.round(1000 / average), p95Ms: Math.round(p95 * 10) / 10, workMs: Math.round(this.work / this.frames.length * 10) / 10, gpuMs: this.timer ? Math.round(this.gpuMs * 10) / 10 : null });
    this.frames.length = 0;
    this.work = 0;
  }

  updateVehicle(group: THREE.Group, focus: THREE.Vector3) {
    group.visible = group.position.distanceToSquared(focus) < 180 * 180;
  }
}
