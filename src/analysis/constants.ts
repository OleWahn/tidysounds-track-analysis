/**
 * Sample rate every recording is decoded to before feature extraction, in Hz.
 */
export const ANALYSIS_SAMPLE_RATE = 22050;

/**
 * Length of one chroma frame in seconds: the STFT chroma is averaged into blocks of this length.
 */
export const FRAME_SECONDS = 0.5;

/**
 * Version of the stored features. Bump it when extraction changes; older features are recomputed.
 */
export const FEATURE_VERSION = 1;

/**
 * Minimum score of the best track for a proposal, 0..1. Placeholder until calibration (#699).
 */
export const PROPOSAL_THRESHOLD = 0.5;

/**
 * Minimum distance of the best track to the second-best for a proposal. Placeholder until calibration (#699).
 */
export const PROPOSAL_MARGIN = 0.1;

/**
 * Recordings shorter than this are not analyzed; they fail permanently.
 */
export const MIN_DURATION_SECONDS = 20;

/**
 * An analysis lock older than this is considered dead and may be taken over.
 */
export const LOCK_TIMEOUT_MS = 10 * 60 * 1000;
