import { createGoldenSeedResolver } from '../../flow-kit/utils/golden-seed';

/**
 * 报销 Golden 种子：expense-flow/datasource/golden-seeds.json
 * { "<env>": { "<roleSlug>": { expenseDocNo } } }
 */
export const resolveGoldenSeed = createGoldenSeedResolver({
  seedsRel: 'expense-flow/datasource/golden-seeds.json',
  docNoKeys: ['expenseDocNo', 'docNo'],
  keywordKeys: ['expenseFilterKeyword', 'keyword'],
});

export type { GoldenSeed } from '../../flow-kit/utils/golden-seed';
