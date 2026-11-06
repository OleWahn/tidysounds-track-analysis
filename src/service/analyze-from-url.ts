import { AnalysisTooShortError, StorageNotFoundError, StorageUnavailableError } from '../../../shared/custom-errors';
import { ANALYSIS_SAMPLE_RATE, ChromaFeatures, decodeToMonoPcm, extractor, MIN_DURATION_SECONDS } from '../analysis';

type Fetch = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer: () => Promise<ArrayBuffer> }>;

/**
 * Downloads a recording from a temporary URL the closed codebase handed over, decodes it and
 * extracts its features. The service holds no storage credentials; the URL is its only access.
 *
 * @param downloadUrl - A temporary, unauthenticated download link of the recording
 * @param fetchImpl - The fetch to use, the global one by default
 * @throws StorageNotFoundError on 404, StorageUnavailableError on any other download failure,
 *   AudioDecodeError when ffmpeg rejects the bytes, AnalysisTooShortError under MIN_DURATION_SECONDS
 * @example
 * const features = await analyzeFromUrl(body.downloadUrl);
 */
export const analyzeFromUrl = async (downloadUrl: string, fetchImpl: Fetch = fetch): Promise<ChromaFeatures> => {
	let response: Awaited<ReturnType<Fetch>>;
	try {
		response = await fetchImpl(downloadUrl);
	} catch (error) {
		throw new StorageUnavailableError(error);
	}
	if (response.status === 404) throw new StorageNotFoundError({ id: downloadUrl });
	if (!response.ok) throw new StorageUnavailableError(`download answered ${response.status}`);
	const bytes = Buffer.from(await response.arrayBuffer());
	const pcm = await decodeToMonoPcm(bytes, ANALYSIS_SAMPLE_RATE);
	const durationSeconds = pcm.length / ANALYSIS_SAMPLE_RATE;
	if (durationSeconds < MIN_DURATION_SECONDS) throw new AnalysisTooShortError(durationSeconds);
	return extractor.extract(pcm, ANALYSIS_SAMPLE_RATE);
};
