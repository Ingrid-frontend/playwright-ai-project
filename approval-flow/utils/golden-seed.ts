import { createGoldenSeedResolver } from '../../flow-kit/utils/golden-seed';

/**
 * 审批 Golden 种子：approval-flow/datasource/golden-seeds.json
 * { "<env>": { "<roleSlug>": { approvalDocNo } } }
 */
export const resolveGoldenSeed = createGoldenSeedResolver({
  seedsRel: 'approval-flow/datasource/golden-seeds.json',
  docNoKeys: ['approvalDocNo', 'docNo'],
  keywordKeys: ['approvalFilterKeyword', 'keyword'],
});

export type { GoldenSeed } from '../../flow-kit/utils/golden-seed';
