import { Essentia, EssentiaWASM, VectorFloat, VectorVectorFloat } from 'essentia.js';
import { ChromaFeatures, Extractor } from './extractor';

const PITCH_CLASSES = 12;
const STFT_SIZE = 4096;
const STFT_HOP = 2048;
const MAX_BYTE = 255;
const MIN_FREQUENCY = 40;
const MAX_FREQUENCY = 5000;
const MAX_PEAKS = 100;
const MIN_TEMPO = 40;
const MAX_TEMPO = 208;
const BEAT_METHOD = 'multifeature';
const TUNING_SAMPLE_STRIDE = 10;
const BINARIZE_PERCENTILE = 0.095;
const FRAME_STACK_SIZE = 9;
const GAP_ONSET = 0.5;
const GAP_EXTENSION = 0.5;

let instance: Essentia | null = null;

const essentia = (): Essentia => {
	if (!instance) instance = new Essentia(EssentiaWASM);
	return instance;
};

const median = (values: number[]): number => {
	const sorted = [...values].sort((x, y) => x - y);
	return sorted.length === 0 ? 440 : sorted[Math.floor(sorted.length / 2)];
};

const beatTimes = (e: Essentia, pcm: Float32Array, durationSeconds: number): number[] => {
	const signal = e.arrayToVector(pcm);
	const rhythm = e.RhythmExtractor2013(signal, MAX_TEMPO, BEAT_METHOD, MIN_TEMPO);
	const ticks = Array.from(e.vectorToArray(rhythm.ticks));
	signal.delete();
	rhythm.ticks.delete();
	rhythm.estimates.delete();
	rhythm.bpmIntervals.delete();
	return [0, ...ticks.filter((t) => t > 0 && t < durationSeconds), durationSeconds];
};

const spectralPeaks = (e: Essentia, frame: VectorFloat, sampleRate: number): { frequencies: VectorFloat; magnitudes: VectorFloat } => {
	const windowed = e.Windowing(frame);
	const spectrum = e.Spectrum(windowed.frame);
	const peaks = e.SpectralPeaks(spectrum.spectrum, 0, MAX_FREQUENCY, MAX_PEAKS, MIN_FREQUENCY, 'magnitude', sampleRate);
	windowed.frame.delete();
	spectrum.spectrum.delete();
	return peaks;
};

const frameCount = (pcm: Float32Array): number => (pcm.length < STFT_SIZE ? 0 : Math.floor((pcm.length - STFT_SIZE) / STFT_HOP) + 1);

const withFrame = <T>(e: Essentia, pcm: Float32Array, index: number, use: (frame: VectorFloat) => T): T => {
	const frame = e.arrayToVector(pcm.subarray(index * STFT_HOP, index * STFT_HOP + STFT_SIZE));
	try {
		return use(frame);
	} finally {
		frame.delete();
	}
};

const tuningFrequency = (e: Essentia, pcm: Float32Array, sampleRate: number): number => {
	const estimates: number[] = [];
	for (let i = 0; i < frameCount(pcm); i += TUNING_SAMPLE_STRIDE) {
		withFrame(e, pcm, i, (frame) => {
			const peaks = spectralPeaks(e, frame, sampleRate);
			if (peaks.frequencies.size() > 0) estimates.push(e.TuningFrequency(peaks.frequencies, peaks.magnitudes).tuningFrequency);
			peaks.frequencies.delete();
			peaks.magnitudes.delete();
		});
	}
	return median(estimates);
};

/**
 * Beat-synchronous HPCP: spectral peaks per STFT frame, HPCP with the recording's own
 * tuning, averaged between consecutive beats, each beat scaled so its strongest pitch class is 255.
 *
 * @param pcm - Mono samples in -1..1
 * @param sampleRate - Sample rate of pcm in Hz
 * @example
 * const features = essentiaExtractor.extract(pcm, ANALYSIS_SAMPLE_RATE);
 */
const extract = (pcm: Float32Array, sampleRate: number): ChromaFeatures => {
	const e = essentia();
	const durationSeconds = pcm.length / sampleRate;
	const beats = beatTimes(e, pcm, durationSeconds);
	const intervals = beats.length - 1;
	const tuning = tuningFrequency(e, pcm, sampleRate);
	const sums = new Float64Array(intervals * PITCH_CLASSES);
	let interval = 0;
	for (let i = 0; i < frameCount(pcm); i++) {
		const center = (i * STFT_HOP + STFT_SIZE / 2) / sampleRate;
		while (interval < intervals - 1 && center >= beats[interval + 1]) interval++;
		withFrame(e, pcm, i, (frame) => {
			const peaks = spectralPeaks(e, frame, sampleRate);
			const hpcp = e.HPCP(peaks.frequencies, peaks.magnitudes, false, 500, 0, MAX_FREQUENCY, false, MIN_FREQUENCY, false, 'unitMax', tuning, sampleRate, PITCH_CLASSES, 'squaredCosine', 1);
			const values = e.vectorToArray(hpcp.hpcp);
			for (let bin = 0; bin < PITCH_CLASSES; bin++) sums[interval * PITCH_CLASSES + bin] += values[bin];
			peaks.frequencies.delete();
			peaks.magnitudes.delete();
			hpcp.hpcp.delete();
		});
	}
	const out = new Uint8Array(intervals * PITCH_CLASSES);
	for (let k = 0; k < intervals; k++) {
		let max = 0;
		for (let bin = 0; bin < PITCH_CLASSES; bin++) max = Math.max(max, sums[k * PITCH_CLASSES + bin]);
		if (max === 0) continue;
		for (let bin = 0; bin < PITCH_CLASSES; bin++) {
			out[k * PITCH_CLASSES + bin] = Math.round((sums[k * PITCH_CLASSES + bin] / max) * MAX_BYTE);
		}
	}
	return { extractor: 'essentia', chroma: out, frames: intervals, durationSeconds };
};

const toMatrix = (e: Essentia, chroma: Uint8Array): VectorVectorFloat => {
	const matrix = new e.module.VectorVectorFloat();
	for (let frame = 0; frame < chroma.length / PITCH_CLASSES; frame++) {
		const row = new Float32Array(PITCH_CLASSES);
		for (let bin = 0; bin < PITCH_CLASSES; bin++) row[bin] = chroma[frame * PITCH_CLASSES + bin] / MAX_BYTE;
		const vector = e.arrayToVector(row);
		matrix.push_back(vector);
		vector.delete();
	}
	return matrix;
};

const matrixMax = (matrix: VectorVectorFloat): { rows: number; columns: number; max: number } => {
	const rows = matrix.size();
	let columns = 0;
	let max = 0;
	for (let i = 0; i < rows; i++) {
		const row = matrix.get(i);
		columns = row.size();
		for (let j = 0; j < columns; j++) max = Math.max(max, row.get(j));
		row.delete();
	}
	return { rows, columns, max };
};

/**
 * Essentia's cover song similarity: binarized chroma cross-similarity with the optimal
 * transposition, then Serra's Qmax alignment; the longest aligned stretch over the shorter side.
 *
 * @param a - Features of one recording
 * @param b - Features of the other recording
 * @returns 0..1
 * @example
 * essentiaExtractor.compare(features, bestRecordingFeatures); // 0.81
 */
const compare = (a: ChromaFeatures, b: ChromaFeatures): number => {
	if (a.frames === 0 || b.frames === 0) return 0;
	const e = essentia();
	const query = toMatrix(e, a.chroma);
	const reference = toMatrix(e, b.chroma);
	const stack = Math.max(1, Math.min(FRAME_STACK_SIZE, a.frames, b.frames));
	const cross = e.ChromaCrossSimilarity(query, reference, BINARIZE_PERCENTILE, stack, 1, PITCH_CLASSES, true, false, false);
	const cover = e.CoverSongSimilarity(cross.csm, 'serra09', GAP_EXTENSION, GAP_ONSET, 'asymmetric');
	const { rows, columns, max } = matrixMax(cover.scoreMatrix);
	query.delete();
	reference.delete();
	cross.csm.delete();
	cover.scoreMatrix.delete();
	const shorter = Math.min(rows, columns);
	return shorter === 0 ? 0 : Math.min(1, max / shorter);
};

/**
 * Extractor B: essentia.js beat-synchronous HPCP with essentia's own cover song alignment.
 * Lives in the calibration package only; AGPL-3.0.
 *
 * @example
 * essentiaExtractor.compare(essentiaExtractor.extract(a, rate), essentiaExtractor.extract(b, rate));
 */
export const essentiaExtractor: Extractor = { id: 'essentia', extract, compare };
