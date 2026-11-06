/**
 * The part of essentia.js the calibration uses. The package ships no type declarations.
 * Vectors live in the WASM heap and must be deleted by hand.
 */
declare module 'essentia.js' {
	interface VectorFloat {
		size(): number;
		get(index: number): number;
		delete(): void;
	}
	interface VectorVectorFloat {
		size(): number;
		get(index: number): VectorFloat;
		push_back(row: VectorFloat): void;
		delete(): void;
	}
	class Essentia {
		constructor(wasmModule: unknown);
		version: string;
		module: { VectorVectorFloat: new () => VectorVectorFloat };
		arrayToVector(array: Float32Array | number[]): VectorFloat;
		vectorToArray(vector: VectorFloat): Float32Array;
		FrameGenerator(signal: Float32Array, frameSize: number, hopSize: number): VectorVectorFloat;
		Windowing(frame: VectorFloat, normalized?: boolean, size?: number, type?: string, zeroPadding?: number, zeroPhase?: boolean): { frame: VectorFloat };
		Spectrum(frame: VectorFloat, size?: number): { spectrum: VectorFloat };
		SpectralPeaks(spectrum: VectorFloat, magnitudeThreshold?: number, maxFrequency?: number, maxPeaks?: number, minFrequency?: number, orderBy?: string, sampleRate?: number): { frequencies: VectorFloat; magnitudes: VectorFloat };
		TuningFrequency(frequencies: VectorFloat, magnitudes: VectorFloat, resolution?: number): { tuningFrequency: number; tuningCents: number };
		HPCP(frequencies: VectorFloat, magnitudes: VectorFloat, bandPreset?: boolean, bandSplitFrequency?: number, harmonics?: number, maxFrequency?: number, maxShifted?: boolean, minFrequency?: number, nonLinear?: boolean, normalized?: string, referenceFrequency?: number, sampleRate?: number, size?: number, weightType?: string, windowSize?: number): { hpcp: VectorFloat };
		RhythmExtractor2013(signal: VectorFloat, maxTempo?: number, method?: string, minTempo?: number): { bpm: number; ticks: VectorFloat; confidence: number; estimates: VectorFloat; bpmIntervals: VectorFloat };
		ChromaCrossSimilarity(queryFeature: VectorVectorFloat, referenceFeature: VectorVectorFloat, binarizePercentile?: number, frameStackSize?: number, frameStackStride?: number, noti?: number, oti?: boolean, otiBinary?: boolean, streaming?: boolean): { csm: VectorVectorFloat };
		CoverSongSimilarity(inputArray: VectorVectorFloat, alignmentType?: string, disExtension?: number, disOnset?: number, distanceType?: string): { scoreMatrix: VectorVectorFloat; distance: number };
	}
	const EssentiaWASM: unknown;
	export { Essentia, EssentiaWASM, VectorFloat, VectorVectorFloat };
}
