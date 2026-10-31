export class LoadingBudget {
  private deadline = performance.now() + 12;

  get exhausted() { return performance.now() >= this.deadline }

  async yield() {
    await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    this.deadline = performance.now() + 12;
  }
}
