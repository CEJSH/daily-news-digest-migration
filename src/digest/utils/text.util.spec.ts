import { trimTitleNoise } from './text.util';

describe('text util', () => {
  it('keeps breaking marker while normalizing title prefix', () => {
    const title = trimTitleNoise(
      '[속보] 관세 협상 급진전 - 연합뉴스',
      '연합뉴스',
    );

    expect(title).toBe('속보 관세 협상 급진전');
  });

  it('strips non-breaking title noise prefixes', () => {
    const title = trimTitleNoise('[단독] 반도체 투자 확대');

    expect(title).toBe('반도체 투자 확대');
  });
});
