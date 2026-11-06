import { essentiaExtractor } from './essentia.extractor';

export * from './constants';
export { decodeToMonoPcm } from './decode';
export type { ChromaFeatures, Extractor, ExtractorId } from './extractor';
export { chooseProposal } from './propose';
export type { ChosenProposal, ScoredCandidate } from './propose';

/**
 * The extractor the service analyzes and compares with: essentia.js, chosen by the calibration
 * of 2026-11-06 (#699).
 */
export const extractor = essentiaExtractor;
