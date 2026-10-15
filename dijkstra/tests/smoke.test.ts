import { describe, expect, it } from 'vitest';
import { chapters } from '../src/chapters';

describe('章の定義', () => {
  it('6章が番号順に並んでいる', () => {
    expect(chapters.map((c) => c.no)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
