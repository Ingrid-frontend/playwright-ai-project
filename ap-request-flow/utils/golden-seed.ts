import { createGoldenSeedResolver } from '../../flow-kit/utils/golden-seed';

/**
 * 对公申请单 Golden 种子：ap-request-flow/datasource/golden-seeds.json
 * { "<env>": { "<roleSlug>": { apRequestDocNo } } }
 */
export const resolveGoldenSeed = createGoldenSeedResolver({
  seedsRel: 'ap-request-flow/datasource/golden-seeds.json',
  docNoKeys: ['apRequestDocNo', 'docNo'],
  keywordKeys: ['apRequestFilterKeyword', 'keyword'],
});

export type { GoldenSeed } from '../../flow-kit/utils/golden-seed';
