import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export type TestEnvPathCjs = typeof import('./test-env-path.cjs');

const cjs = require('./test-env-path.cjs') as TestEnvPathCjs;

export const loadTestPathLayout = cjs.loadTestPathLayout;
export const listKnownEnvs = cjs.listKnownEnvs;
export const isKnownEnv = cjs.isKnownEnv;
export const getLegacyEnvDefault = cjs.getLegacyEnvDefault;
export const isEnvSegmentEnabled = cjs.isEnvSegmentEnabled;
export const parseOptimizedRel = cjs.parseOptimizedRel;
export const parseRawOriginalRel = cjs.parseRawOriginalRel;
export const parseEnvFromSpecRel = cjs.parseEnvFromSpecRel;
export const buildRawOriginalRel = cjs.buildRawOriginalRel;
export const buildOptimizedRel = cjs.buildOptimizedRel;
export const buildScreenshotDir = cjs.buildScreenshotDir;
export const specMatchesEnv = cjs.specMatchesEnv;
export const shouldEnforceSpecEnv = cjs.shouldEnforceSpecEnv;
export const assertSpecEnvMatch = cjs.assertSpecEnvMatch;
export const optimizedImportDepthFromRel = cjs.optimizedImportDepthFromRel;
export const optimizedImportPathsForDepth = cjs.optimizedImportPathsForDepth;
export const parseEnvAndDateCategoryFromRawOrProcessed = cjs.parseEnvAndDateCategoryFromRawOrProcessed;
export const resolveRepoRoot = cjs.resolveRepoRoot;
