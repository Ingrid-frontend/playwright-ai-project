/** 新建单据事由：时间戳 + 4 位随机数，避免列表撞车 */
export function randomReason(prefix = '自动化申请单事由') {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  const n = Math.floor(Math.random() * 9000) + 1000;
  return `${prefix}-${stamp}-${n}`;
}

export function pickRandom<T>(items: T[]): T {
  if (!items.length) throw new Error('pickRandom: 空列表');
  return items[Math.floor(Math.random() * items.length)]!;
}
