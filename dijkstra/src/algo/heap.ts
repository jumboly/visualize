/**
 * (key, value) の二分ヒープによる優先度付きキュー。
 * 同じ key のときは value の小さい方を先に出す。Why: 同点時の取り出し順を固定し、
 * 毎回まったく同じ探索イベント列を再現できるようにするため。
 */
export class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, val: number): void {
    this.keys.push(key);
    this.vals.push(val);
    this.up(this.keys.length - 1);
  }

  /** 最小要素を取り出す。空なら undefined */
  pop(): { key: number; val: number } | undefined {
    const n = this.keys.length;
    if (n === 0) return undefined;
    const top = { key: this.keys[0], val: this.vals[0] };
    const lk = this.keys.pop()!;
    const lv = this.vals.pop()!;
    if (n > 1) {
      this.keys[0] = lk;
      this.vals[0] = lv;
      this.down(0);
    }
    return top;
  }

  private less(i: number, j: number): boolean {
    return this.keys[i] < this.keys[j] || (this.keys[i] === this.keys[j] && this.vals[i] < this.vals[j]);
  }

  private swap(i: number, j: number): void {
    [this.keys[i], this.keys[j]] = [this.keys[j], this.keys[i]];
    [this.vals[i], this.vals[j]] = [this.vals[j], this.vals[i]];
  }

  private up(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  private down(i: number): void {
    const n = this.keys.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < n && this.less(l, m)) m = l;
      if (r < n && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
  }
}
