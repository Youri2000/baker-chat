/**
 * @file 打字机节奏：给定已收到的回复文本、当前显示进度与经过的时间，算出新的显示进度与界面上可见的内容。
 * 纯函数，不依赖 React、DOM 与计时器；计时由 chatStore 驱动，这里只做计算，方便用任意时间步长做单元测试。
 * 规则：一行一个气泡，按行逐字写出；平时约每秒 40 字，积压越多写得越快，正在写的内容最多落后网络约 1 秒；
 * 一行写完后固定停顿 0.5 秒（显示加载气泡）再写下一行，停顿不计入追赶；表情 token 作为一个整体出现。
 * 💡 追赶窗口按"只在打字时走的时钟"计算，停顿再多也不会把打字挤成一瞬间，详见 docs/interview.md#typewriter
 */

/** 平时的出字速度（字 / 秒） */
export const BASE_RATE = 40;
/** 正在写的内容最多落后网络到达的时间（毫秒，按打字时钟计） */
export const MAX_LAG_MS = 1000;
/** 一行写完到下一行开始之间的停顿（毫秒） */
export const LINE_PAUSE_MS = 500;
/** 追赶窗口的下限：只防止除以 0 或负数；过了截止时间，剩余的积压在下一步内全部写出 */
const MIN_WINDOW_MS = 1;

/** 一个显示单位：表情 token 整体一个，其余按码点 */
const UNIT_RE = /\[sns_emoji_\d{3}\]|[\s\S]/gu;
/** 未收完的行末尾若是某个表情 token 的开头（如 `[sns_em`），先不显示，等它完整或流结束 */
const PARTIAL_TOKEN_RE = /\[(?:s(?:n(?:s(?:_(?:e(?:m(?:o(?:j(?:i(?:_\d{0,3})?)?)?)?)?)?)?)?)?)?$/u;

/** 把一行文本切成显示单位 */
export function splitUnits(text: string): string[] {
  return text.match(UNIT_RE) ?? [];
}

/** 已收到的回复按行整理后的结果 */
export interface ReplySource {
  /** 每行的显示单位；按 `\n` 分行、去首尾空白、跳过空行，与后端落库规则一致；最后一项可能是未收完的行 */
  lines: string[][];
  /** 已完整收到的行数：流结束后全部算完整，否则最后一段没有换行的内容不算 */
  complete: number;
  /** 流已结束 */
  done: boolean;
}

/** 把已收到的文本整理成行；未收完的行只取可以安全显示的部分（去掉首尾空白与末尾半个表情 token） */
export function readSource(received: string, done: boolean): ReplySource {
  const parts = received.split('\n');
  const tail = done ? '' : (parts.pop() ?? '');
  const lines = parts
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map(splitUnits);
  const complete = lines.length;
  const partial = tail.trim().replace(PARTIAL_TOKEN_RE, '').trimEnd();
  if (partial !== '') lines.push(splitUnits(partial));
  return { lines, complete, done };
}

/** 显示进度 */
export interface TypewriterState {
  /** 正在写（或刚写完、正在停顿）的行 */
  line: number;
  /** 该行已显示的单位数 */
  shown: number;
  /** 还没用完的出字额度（单位数，可为小数） */
  budget: number;
  /** 行间停顿剩余毫秒；大于 0 时显示加载气泡 */
  pauseLeft: number;
  /** 打字时钟（毫秒）：停顿时不走，追赶窗口按它计算 */
  clock: number;
  /** 最近一次收到新内容时的打字时钟 */
  arrivedAt: number;
  /** 已收到的可显示单位总数，用来发现新内容 */
  received: number;
  /** 全部内容已写完 */
  finished: boolean;
}

/** 一次回复开始时的进度 */
export const INITIAL_TYPEWRITER: TypewriterState = {
  line: 0,
  shown: 0,
  budget: 0,
  pauseLeft: 0,
  clock: 0,
  arrivedAt: 0,
  received: 0,
  finished: false,
};

/** 所有行的单位总数 */
function countUnits(lines: string[][], end = lines.length): number {
  let total = 0;
  for (let i = 0; i < end; i += 1) total += lines[i].length;
  return total;
}

/**
 * 推进 dt 毫秒：先登记新到达的内容，再依次消耗停顿与打字时间，可跨越多行。
 * 没有内容可写时剩余时间直接丢弃，不攒成额度，新内容到达后仍按正常速度开始写。
 */
export function step(prev: TypewriterState, source: ReplySource, dt: number): TypewriterState {
  if (prev.finished) return prev;
  const s = { ...prev };
  const total = countUnits(source.lines);
  if (total > s.received) {
    s.received = total;
    s.arrivedAt = s.clock;
  }
  let left = dt;
  for (;;) {
    const lastIndex = source.lines.length - 1;
    // 流已结束且停顿的是最后一行：不再等下一行，直接结束
    if (s.pauseLeft > 0 && source.done && s.line >= lastIndex) {
      s.pauseLeft = 0;
      s.finished = true;
      break;
    }
    if (s.pauseLeft > 0) {
      const used = Math.min(left, s.pauseLeft);
      s.pauseLeft -= used;
      left -= used;
      if (s.pauseLeft > 0) break;
      s.line += 1;
      s.shown = 0;
      s.budget = 0;
      continue;
    }
    const units = source.lines[s.line];
    if (units === undefined) {
      // 下一行还没到：流已结束就写完了，否则继续显示加载气泡
      if (source.done) s.finished = true;
      break;
    }
    if (s.shown >= units.length) {
      // 未收完的行已追上到达的内容，等更多内容
      if (s.line >= source.complete) break;
      if (source.done && s.line === lastIndex) {
        s.finished = true;
        break;
      }
      s.pauseLeft = LINE_PAUSE_MS;
      continue;
    }
    if (left <= 0) break;
    // 积压 = 已收到但还没写出的单位，扣掉已攒下的小数额度，否则追赶会一直略慢于窗口、拖过截止时间
    const backlog = Math.max(s.received - countUnits(source.lines, s.line) - s.shown - s.budget, 0);
    const window = Math.max(s.arrivedAt + MAX_LAG_MS - s.clock, MIN_WINDOW_MS);
    // 单位 / 毫秒：平时按基础速度，积压多时保证在窗口内写完
    const rate = Math.max(BASE_RATE / 1000, backlog / window);
    const need = Math.max((units.length - s.shown - s.budget) / rate, 0);
    const used = Math.min(left, need);
    s.clock += used;
    left -= used;
    s.budget += used * rate;
    // 浮点误差：刚好够一个单位时 budget 可能是 0.9999999
    const add = Math.min(Math.floor(s.budget + 1e-9), units.length - s.shown);
    s.shown += add;
    s.budget = Math.max(s.budget - add, 0);
    if (s.shown < units.length) break;
    s.budget = 0;
  }
  return s;
}

/** 界面上可见的内容 */
export interface TypewriterView {
  /** 每个临时气泡的文字：之前的行完整，正在写的行是已写出的前缀 */
  lines: string[];
  /** 最后一个气泡还在写（尺寸会继续变化） */
  typing: boolean;
  /** 显示加载气泡：首个字前、行间停顿中、下一行还没到时 */
  loading: boolean;
}

/** 按当前进度算出可见内容 */
export function view(state: TypewriterState, source: ReplySource): TypewriterView {
  const lines = source.lines.slice(0, state.line).map((units) => units.join(''));
  const current = source.lines[state.line];
  if (current !== undefined && state.shown > 0) {
    lines.push(current.slice(0, state.shown).join(''));
  }
  const lineDone =
    current !== undefined && state.shown >= current.length && state.line < source.complete;
  return {
    lines,
    typing: !state.finished && current !== undefined && state.shown > 0 && !lineDone,
    loading: !state.finished && (state.pauseLeft > 0 || current === undefined || state.shown === 0),
  };
}

/** 整行显示（打字机关闭或减少动态效果）：只显示完整的行，流结束前一直显示加载气泡 */
export function lineView(source: ReplySource): TypewriterView {
  return {
    lines: source.lines.slice(0, source.complete).map((units) => units.join('')),
    typing: false,
    loading: !source.done,
  };
}
