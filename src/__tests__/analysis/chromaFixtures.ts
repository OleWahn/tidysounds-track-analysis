import { ANALYSIS_SAMPLE_RATE } from '../../analysis/constants';

const PITCH_CLASSES = 12;
const DIATONIC_ROOTS = [0, 2, 4, 5, 7, 9, 11];
const CHORD_SECONDS = 7.5;

/**
 * Sine chords C, F, G, C: the test progression of the extractor tests.
 */
export const C_F_G_C = [
	[261.63, 329.63, 392.0],
	[349.23, 440.0, 523.25],
	[392.0, 493.88, 587.33],
	[261.63, 329.63, 392.0]
];

/**
 * Sine chords C, Eb, Gb, A, roots a minor third apart: a progression whose root movement
 * matches C_F_G_C in no transposition.
 */
export const C_EB_GB_A = [
	[261.63, 329.63, 392.0],
	[311.13, 392.0, 466.16],
	[369.99, 466.16, 554.37],
	[440.0, 554.37, 659.25]
];

/**
 * 30 s of sine chords, each held 7.5 s, at the analysis sample rate.
 *
 * @param progression - Four chords, each a list of frequencies in Hz; C_F_G_C by default
 * @example
 * const pcm = chordPcm(); // Float32Array of 661500 samples
 */
export const chordPcm = (progression: number[][] = C_F_G_C): Float32Array => {
	const samplesPerChord = Math.round(CHORD_SECONDS * ANALYSIS_SAMPLE_RATE);
	const pcm = new Float32Array(samplesPerChord * progression.length);
	progression.forEach((chord, index) => {
		for (let i = 0; i < samplesPerChord; i++) {
			const t = i / ANALYSIS_SAMPLE_RATE;
			let sample = 0;
			for (const frequency of chord) sample += Math.sin(2 * Math.PI * frequency * t);
			pcm[index * samplesPerChord + i] = sample / chord.length;
		}
	});
	return pcm;
};
const MINOR_DEGREES = new Set([1, 2, 5]);
const CHORDS_PER_SONG = 8;
const MIN_FRAMES_PER_CHORD = 3;
const MAX_FRAMES_PER_CHORD = 6;

/**
 * Deterministic pseudo-random numbers in 0..1 from a seed (a linear congruential generator).
 *
 * @param seed - Any integer; the same seed gives the same sequence
 * @example
 * const next = random(1); next(); // 0.0000217...
 */
export const random = (seed: number): (() => number) => {
	let state = (seed >>> 0) || 1;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 0x100000000;
	};
};

const chordTemplate = (root: number, minor: boolean, next: () => number): number[] => {
	const bins = new Array<number>(PITCH_CLASSES).fill(0).map(() => 10 + Math.floor(next() * 30));
	bins[root % PITCH_CLASSES] = 255;
	bins[(root + (minor ? 3 : 4)) % PITCH_CLASSES] = 200;
	bins[(root + 7) % PITCH_CLASSES] = 180;
	return bins;
};

/**
 * A synthetic chroma sequence of a song: 8 diatonic chords of one key, each held for a few
 * frames, repeated until the length is reached, with a little noise per frame. 12 bytes per frame.
 *
 * @param seed - Picks the chords and the noise; the same seed gives the same song
 * @param length - Number of frames
 * @example
 * const song = chordSequence(1, 120); // 1440 bytes
 */
export const chordSequence = (seed: number, length: number): Uint8Array => {
	const next = random(seed);
	const chords = Array.from({ length: CHORDS_PER_SONG }, () => {
		const degree = Math.floor(next() * DIATONIC_ROOTS.length);
		return chordTemplate(DIATONIC_ROOTS[degree], MINOR_DEGREES.has(degree), next);
	});
	const frames: number[][] = [];
	let chordIndex = 0;
	while (frames.length < length) {
		const hold = MIN_FRAMES_PER_CHORD + Math.floor(next() * (MAX_FRAMES_PER_CHORD - MIN_FRAMES_PER_CHORD + 1));
		const chord = chords[chordIndex % chords.length];
		for (let i = 0; i < hold && frames.length < length; i++) {
			frames.push(chord.map((value) => Math.max(0, Math.min(255, value + Math.floor((next() - 0.5) * 30)))));
		}
		chordIndex++;
	}
	return Uint8Array.from(frames.flat());
};

/**
 * The same song played at another tempo: frames are resampled by the factor.
 *
 * @param seq - 12 bytes per frame
 * @param factor - 1.25 makes the song 25% longer (slower), 0.8 shorter (faster)
 * @example
 * stretch(song, 1.25);
 */
export const stretch = (seq: Uint8Array, factor: number): Uint8Array => {
	const frames = seq.length / PITCH_CLASSES;
	const outFrames = Math.max(1, Math.round(frames * factor));
	const out = new Uint8Array(outFrames * PITCH_CLASSES);
	for (let i = 0; i < outFrames; i++) {
		const source = Math.min(frames - 1, Math.floor(i / factor));
		out.set(seq.subarray(source * PITCH_CLASSES, source * PITCH_CLASSES + PITCH_CLASSES), i * PITCH_CLASSES);
	}
	return out;
};

/**
 * The same song in another key: every frame's pitch classes are rolled by the interval.
 *
 * @param seq - 12 bytes per frame
 * @param semitones - Interval upwards, 0..11
 * @example
 * transpose(song, 2); // a whole tone higher
 */
export const transpose = (seq: Uint8Array, semitones: number): Uint8Array => {
	const out = new Uint8Array(seq.length);
	for (let frame = 0; frame < seq.length / PITCH_CLASSES; frame++) {
		for (let bin = 0; bin < PITCH_CLASSES; bin++) {
			out[frame * PITCH_CLASSES + ((bin + semitones) % PITCH_CLASSES)] = seq[frame * PITCH_CLASSES + bin];
		}
	}
	return out;
};

/**
 * The song cut off: only the first fraction of its frames.
 *
 * @param seq - 12 bytes per frame
 * @param fraction - 0..1
 * @example
 * cut(song, 0.6);
 */
export const cut = (seq: Uint8Array, fraction: number): Uint8Array => {
	const frames = Math.max(1, Math.floor((seq.length / PITCH_CLASSES) * fraction));
	return seq.slice(0, frames * PITCH_CLASSES);
};

/**
 * A different song with the same chords: the frames in a random order, so the global
 * profile matches but no stretch of it lines up.
 *
 * @param seq - 12 bytes per frame
 * @param seed - Picks the permutation
 * @example
 * shuffleFrames(song, 7);
 */
export const shuffleFrames = (seq: Uint8Array, seed: number): Uint8Array => {
	const next = random(seed);
	const frames = seq.length / PITCH_CLASSES;
	const order = Array.from({ length: frames }, (_, i) => i);
	for (let i = order.length - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		[order[i], order[j]] = [order[j], order[i]];
	}
	const out = new Uint8Array(seq.length);
	order.forEach((source, target) => {
		out.set(seq.subarray(source * PITCH_CLASSES, source * PITCH_CLASSES + PITCH_CLASSES), target * PITCH_CLASSES);
	});
	return out;
};
