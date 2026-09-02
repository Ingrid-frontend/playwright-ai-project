import { createGoldenSeedResolver } from '../../flow-kit/utils/golden-seed';

/**
 * 申请单 Golden 种子：request-flow/datasource/golden-seeds.json
 * { "<env>": { "<roleSlug>": { requestDocNo, requestFilterKeyword } } }
 */
export const resolveGoldenSeed = createGoldenSeedResolver({
  seedsRel: 'request-flow/datasource/golden-seeds.json',
  docNoKeys: ['requestDocNo', 'docNo'],
  keywordKeys: ['requestFilterKeyword', 'keyword'],
});

export type { GoldenSeed } from '../../flow-kit/utils/golden-seed';
