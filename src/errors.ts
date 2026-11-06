/**
 * Base of every failure the analysis knows. `retryable` says whether a later run may succeed
 * (the download was temporarily unavailable) or never will (the audio cannot be decoded).
 */
export abstract class AnalysisError extends Error {
	abstract readonly retryable: boolean;
}

/**
 * The download URL answered 404: the recording file is gone from the band's storage.
 *
 * @param downloadUrl - The URL that was asked for
 * @example
 * throw new DownloadNotFoundError(url);
 */
export class DownloadNotFoundError extends AnalysisError {
	readonly retryable = false;
	constructor(public readonly downloadUrl: string) {
		super('Recording file not found at its download URL');
		this.name = 'DownloadNotFoundError';
	}
}

/**
 * The download failed for now: network error, or a status other than 2xx and 404.
 *
 * @param detail - The status or the underlying error
 * @example
 * throw new DownloadUnavailableError(503);
 */
export class DownloadUnavailableError extends AnalysisError {
	readonly retryable = true;
	constructor(public readonly detail: unknown) {
		super(`Recording download unavailable: ${detail instanceof Error ? detail.message : String(detail)}`);
		this.name = 'DownloadUnavailableError';
	}
}

/**
 * ffmpeg could not decode the recording's bytes, so no features can be computed for it.
 *
 * @param detail - The tail of ffmpeg's error output
 * @example
 * throw new AudioDecodeError('Invalid data found when processing input');
 */
export class AudioDecodeError extends AnalysisError {
	readonly retryable = false;
	constructor(public readonly detail: string) {
		super(`Audio could not be decoded: ${detail}`);
		this.name = 'AudioDecodeError';
	}
}

/**
 * The recording is too short to compare with others, so it is never analyzed.
 *
 * @param durationSeconds - The decoded length
 * @example
 * throw new AnalysisTooShortError(12);
 */
export class AnalysisTooShortError extends AnalysisError {
	readonly retryable = false;
	constructor(public readonly durationSeconds: number) {
		super(`Recording is too short for analysis: ${durationSeconds.toFixed(1)} s`);
		this.name = 'AnalysisTooShortError';
	}
}

/**
 * The recording is larger or longer than the analysis handles within its memory and time, so
 * it is never analyzed.
 *
 * @param detail - What was too large: bytes or seconds
 * @example
 * throw new AnalysisTooLargeError('312 MB');
 */
export class AnalysisTooLargeError extends AnalysisError {
	readonly retryable = false;
	constructor(public readonly detail: string) {
		super(`Recording is too large for analysis: ${detail}`);
		this.name = 'AnalysisTooLargeError';
	}
}

/**
 * Whether a failed run may succeed later. Unknown errors count as retryable, so a bug or an
 * outage never turns into a permanent failure.
 *
 * @param error - What the run threw
 * @example
 * retryableFailure(new AudioDecodeError('bad')); // false
 */
export const retryableFailure = (error: unknown): boolean => (error instanceof AnalysisError ? error.retryable : true);
