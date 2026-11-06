export type ExtractorId = 'essentia';

/**
 * The chroma features of one recording: 12 pitch-class bytes per frame.
 */
export interface ChromaFeatures {
	extractor: ExtractorId;
	chroma: Uint8Array;
	frames: number;
	durationSeconds: number;
}

/**
 * Turns decoded audio into chroma features and compares two feature sets.
 * Implementations differ in how they compute chroma and align it; the rest of the
 * analysis never looks inside.
 *
 * @example
 * const features = extractor.extract(pcm, ANALYSIS_SAMPLE_RATE);
 * const score = extractor.compare(features, bestRecordingFeatures); // 0..1
 */
export interface Extractor {
	id: ExtractorId;
	extract(pcm: Float32Array, sampleRate: number): ChromaFeatures;
	compare(a: ChromaFeatures, b: ChromaFeatures): number;
}
