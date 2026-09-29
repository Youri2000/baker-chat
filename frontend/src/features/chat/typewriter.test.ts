/**
 * @file 打字机节奏纯函数测试：显示单位与分行、平时速度、积压追赶、慢速到达、行间固定停顿且不计入追赶、
 * 流结束时的收尾、空闲时间不攒额度、任意时刻只显示最终文本的前缀、表情 token 整体出现、整行显示模式。
 * 时间用固定步长模拟（与 chatStore 的 16ms 计时一致），不依赖真实计时器。
 */
import { describe, expect, it } from 'vitest';
import {
  INITIAL_TYPEWRITER,
  LINE_PAUSE_MS,
  lineView,
  readSource,
  splitUnits,
  step,
  view,
  type TypewriterState,
} from '@/features/chat/typewriter';

/** 与 chatStore 的推进步长一致 */
const TICK = 16;

/** 一段模拟：按固定步长推进，记录每一步之后的可见内容 */
interface Run {
  state: TypewriterState;
  /** 每步结束时的时间（毫秒）与可见内容 */
  frames: Array<{ t: number; lines: string[]; loading: boolean; typing: boolean }>;
}

/** 在同一份已收到的文本上推进 ms 毫秒 */
function run(received: string, done: boolean, ms: number, from: Run = fresh()): Run {
  const source = readSource(received, done);
  let { state } = from;
  const frames = [...from.frames];
  let t = frames.at(-1)?.t ?? 0;
  // 先登记新内容（dt = 0），与 chatStore 收到增量时的做法一致
  state = step(state, source, 0);
  for (let elapsed = 0; elapsed < ms; elapsed += TICK) {
    const dt = Math.min(TICK, ms - elapsed);
    state = step(state, source, dt);
    t += dt;
    frames.push({ t, ...view(state, source) });
  }
  return { state, frames };
}

/** 空白的开始状态 */
function fresh(): Run {
  return { state: INITIAL_TYPEWRITER, frames: [] };
}

/** 第一次满足条件的帧时间 */
function firstTime(r: Run, predicate: (frame: Run['frames'][number]) => boolean): number {
  const frame = r.frames.find(predicate);
  if (frame === undefined) throw new Error('条件从未满足');
  return frame.t;
}

describe('splitUnits / readSource', () => {
  /** 表情 token 算一个单位，其余按码点（emoji 字符不被拆成两个代理项） */
  it('表情 token 与码点各算一个单位', () => {
    expect(splitUnits('你好[sns_emoji_001]世界')).toEqual([
      '你',
      '好',
      '[sns_emoji_001]',
      '世',
      '界',
    ]);
    expect(splitUnits('😀a')).toEqual(['😀', 'a']);
  });

  /** 分行与后端一致：去首尾空白、跳过空行；未收完的行单独一项、不算完整 */
  it('按行整理，未收完的行不算完整', () => {
    const partial = readSource('  第一行 \n\n第二', false);
    expect(partial.lines.map((l) => l.join(''))).toEqual(['第一行', '第二']);
    expect(partial.complete).toBe(1);
    const done = readSource('  第一行 \n\n第二', true);
    expect(done.complete).toBe(2);
  });

  /** 未收完的行末尾是半个表情 token 时先不显示；流结束后按原文显示 */
  it('末尾半个表情 token 暂不显示', () => {
    expect(readSource('你[sns_em', false).lines).toEqual([['你']]);
    expect(readSource('你[sns_emoji_001', false).lines).toEqual([['你']]);
    expect(readSource('你[sns_emoji_001]', false).lines).toEqual([['你', '[sns_emoji_001]']]);
    expect(readSource('你[注', false).lines).toEqual([['你', '[', '注']]);
  });
});

describe('step / view', () => {
  /** 平时约每秒 40 字：一行 40 字 0.5 秒写出约一半 */
  it('平时按每秒约 40 字写出', () => {
    const r = run(`${'字'.repeat(40)}\n`, false, 500);
    expect(r.state.shown).toBeGreaterThanOrEqual(19);
    expect(r.state.shown).toBeLessThanOrEqual(21);
    expect(r.frames.at(-1)).toMatchObject({ typing: true, loading: false });
  });

  /** 积压时追赶：一次送来 200 字的一行，1 秒内写完，而不是按每秒 40 字写 5 秒 */
  it('一次送来 200 字的一行，1 秒左右写完', () => {
    const r = run('字'.repeat(200), false, 1500);
    const firstChar = firstTime(r, (f) => f.lines.length > 0);
    const allShown = firstTime(r, (f) => f.lines[0]?.length === 200);
    expect(allShown - firstChar).toBeLessThanOrEqual(1000 + TICK);
    expect(allShown - firstChar).toBeGreaterThanOrEqual(900);
  });

  /** 慢速到达（每秒约 20 字）：每个字到达后很快就显示，不会越落越多 */
  it('慢速到达时写出的内容跟上到达的内容', () => {
    let r = fresh();
    let received = '';
    let worstLag = 0;
    for (let i = 1; i <= 40; i += 1) {
      received += '字';
      r = run(received, false, 50, r);
      // 本次到达之后的 50ms 内是否已显示全部 i 个字
      const shownAt = r.frames.slice(-4).find((f) => (f.lines[0]?.length ?? 0) >= i);
      worstLag = Math.max(worstLag, shownAt === undefined ? Infinity : shownAt.t - (i - 1) * 50);
    }
    expect(worstLag).toBeLessThanOrEqual(500);
  });

  /** 一行写完后固定停顿 0.5 秒：期间显示加载气泡，可见内容只有写完的那一行 */
  it('行间停顿 0.5 秒并显示加载气泡', () => {
    const r = run('甲乙\n丙丁\n', false, 1200);
    const lineOneDone = firstTime(r, (f) => f.lines[0] === '甲乙' && f.loading);
    const lineTwoStart = firstTime(r, (f) => f.lines.length === 2);
    const gap = lineTwoStart - lineOneDone;
    expect(gap).toBeGreaterThanOrEqual(LINE_PAUSE_MS);
    expect(gap).toBeLessThanOrEqual(LINE_PAUSE_MS + 25 + TICK * 2);
    const during = r.frames.find((f) => f.t > lineOneDone + 100 && f.t < lineOneDone + 400);
    expect(during).toMatchObject({ lines: ['甲乙'], loading: true, typing: false });
  });

  /** 下一行积压很多时停顿也不缩短 */
  it('积压不缩短行间停顿', () => {
    const r = run(`甲\n${'字'.repeat(300)}\n`, false, 1500);
    const lineOneDone = firstTime(r, (f) => f.lines[0] === '甲' && f.loading);
    const lineTwoStart = firstTime(r, (f) => f.lines.length === 2);
    // 停顿从写完那一刻开始，而观测帧晚于它最多一个步长
    expect(lineTwoStart - lineOneDone).toBeGreaterThanOrEqual(LINE_PAUSE_MS - TICK);
  });

  /** 停顿不计入追赶：三行各 40 字一次到达，打字约 1 秒 + 两次停顿 1 秒，约 2 秒写完 */
  it('多行一次到达：打字时间受追赶限制，停顿照常', () => {
    const line = '字'.repeat(40);
    const r = run(`${line}\n${line}\n${line}`, true, 3000);
    const finishedAt = firstTime(r, (f) => f.lines.length === 3 && f.lines[2].length === 40);
    expect(finishedAt).toBeGreaterThanOrEqual(1900);
    expect(finishedAt).toBeLessThanOrEqual(2100);
    expect(r.state.finished).toBe(true);
    expect(r.frames.at(-1)).toMatchObject({ loading: false, typing: false });
  });

  /** 最后一行写完后不再停顿：流已结束就直接结束 */
  it('流结束后最后一行写完即结束', () => {
    const r = run('甲乙', true, 200);
    const shownAt = firstTime(r, (f) => f.lines[0] === '甲乙');
    const end = r.frames.find((f) => f.t === shownAt);
    expect(end).toMatchObject({ loading: false, typing: false });
    expect(r.state.finished).toBe(true);
  });

  /** 停顿期间流结束且没有下一行：立即结束，加载气泡消失 */
  it('停顿中流结束且没有下一行时立即结束', () => {
    let r = run('甲乙\n', false, 200);
    expect(r.state.pauseLeft).toBeGreaterThan(0);
    r = run('甲乙\n', true, TICK, r);
    expect(r.state.finished).toBe(true);
    expect(r.frames.at(-1)).toMatchObject({ lines: ['甲乙'], loading: false });
  });

  /** 首个字到达前显示加载气泡 */
  it('没有内容时只显示加载气泡', () => {
    const r = run('', false, 100);
    expect(r.frames.at(-1)).toEqual({ t: 100, lines: [], loading: true, typing: false });
  });

  /** 空闲时间不攒成额度：追上后等了 5 秒，新到的 40 字仍按平时速度写 */
  it('空闲后新内容按正常速度开始写', () => {
    let r = run('甲', false, 200);
    r = run('甲', false, 5000, r);
    r = run(`甲${'字'.repeat(40)}`, false, 100, r);
    expect(r.state.shown).toBeLessThanOrEqual(1 + 5);
  });

  /** 任意时刻每个可见行都是最终文本对应行的前缀（包括分块把字、换行与 token 切开的情况） */
  it('可见内容始终是最终文本的前缀', () => {
    const chunks = ['第一', '行\n第', '二行[sns_', 'emoji_001]', '尾巴\n  第三行 '];
    const finalLines = readSource(chunks.join(''), true).lines.map((l) => l.join(''));
    let r = fresh();
    let received = '';
    for (const chunk of chunks) {
      received += chunk;
      r = run(received, false, 80, r);
    }
    r = run(received, true, 3000, r);
    for (const frame of r.frames) {
      frame.lines.forEach((line, i) => expect(finalLines[i].startsWith(line)).toBe(true));
    }
    expect(r.frames.at(-1)?.lines).toEqual(finalLines);
  });

  /** 表情 token 整体出现：任何时刻都不出现 [sns_emoji 片段 */
  it('表情 token 整体出现', () => {
    const r = run('你好[sns_emoji_001]世界', true, 1000);
    const seen = new Set(r.frames.map((f) => f.lines[0] ?? ''));
    for (const text of seen) {
      expect(text.replace('[sns_emoji_001]', '')).not.toMatch(/\[/);
    }
    expect(seen).toContain('你好[sns_emoji_001]');
    expect(r.frames.at(-1)?.lines).toEqual(['你好[sns_emoji_001]世界']);
  });
});

describe('lineView', () => {
  /** 整行显示：只显示完整的行，流结束前显示加载气泡，结束后剩余内容作为最后一行 */
  it('整行显示模式', () => {
    expect(lineView(readSource('第一行\n第二', false))).toEqual({
      lines: ['第一行'],
      loading: true,
      typing: false,
    });
    expect(lineView(readSource('第一行\n第二', true))).toEqual({
      lines: ['第一行', '第二'],
      loading: false,
      typing: false,
    });
  });
});
