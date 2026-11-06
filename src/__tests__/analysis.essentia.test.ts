import { ANALYSIS_SAMPLE_RATE } from '../analysis/constants';
import { essentiaExtractor } from '../analysis/essentia.extractor';
import { C_EB_GB_A, chordPcm } from './analysis/chromaFixtures';

const PITCH_CLASSES = 12;

describe('essentia.js on this Node', () => {
	it('loads and constructs', () => {
		const { Essentia, EssentiaWASM } = require('essentia.js');
		const essentia = new Essentia(EssentiaWASM);
		expect(typeof essentia.version).toBe('string');
	});
});

describe('essentiaExtractor', () => {
	const features = essentiaExtractor.extract(chordPcm(), ANALYSIS_SAMPLE_RATE);

	it('is the essentia extractor', () => {
		expect(essentiaExtractor.id).toBe('essentia');
		expect(features.extractor).toBe('essentia');
	});

	it('produces one frame per beat', () => {
		expect(features.frames).toBeGreaterThan(0);
		expect(features.chroma.length).toBe(features.frames * PITCH_CLASSES);
		expect(features.durationSeconds).toBeCloseTo(30, 1);
	});

	it('frees its WASM memory between extractions and comparisons', () => {
		const { EssentiaWASM } = require('essentia.js');
		const heapBytes = (): number => (EssentiaWASM as { HEAPU8: Uint8Array }).HEAPU8.buffer.byteLength;
		const pcm = chordPcm();
		essentiaExtractor.extract(pcm, ANALYSIS_SAMPLE_RATE);
		essentiaExtractor.extract(pcm, ANALYSIS_SAMPLE_RATE);
		const before = heapBytes();
		for (let i = 0; i < 10; i++) {
			const extracted = essentiaExtractor.extract(pcm, ANALYSIS_SAMPLE_RATE);
			essentiaExtractor.compare(extracted, extracted);
		}
		expect(heapBytes()).toBe(before);
	});

	it('scores a song higher against itself than against another progression', () => {
		const other = essentiaExtractor.extract(chordPcm(C_EB_GB_A), ANALYSIS_SAMPLE_RATE);
		const self = essentiaExtractor.compare(features, features);
		expect(self).toBeGreaterThan(0);
		expect(self).toBeLessThanOrEqual(1);
		expect(essentiaExtractor.compare(features, other)).toBeLessThan(self);
	});
});
