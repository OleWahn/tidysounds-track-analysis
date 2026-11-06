import { ANALYSIS_SAMPLE_RATE, ChromaFeatures, decodeToMonoPcm, extractor, MAX_DURATION_SECONDS, MAX_DOWNLOAD_BYTES, MIN_DURATION_SECONDS } from '../analysis';
import { AnalysisTooLargeError, AnalysisTooShortError, DownloadNotFoundError, DownloadUnavailableError } from '../errors';

type Fetch = (url: string) => Promise<{
	ok: boolean;
	status: number;
	headers?: { get: (name: string) => string | null };
	arrayBuffer: () => Promise<ArrayBuffer>;
}>;

const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

/**
 * Downloads a recording from a temporary URL the closed codebase handed over, decodes it and
 * extracts its features. The service holds no storage credentials; the URL is its only access.
 * Files beyond MAX_DOWNLOAD_BYTES or MAX_DURATION_SECONDS are refused for good, so one oversized
 * recording cannot crash the service once per listener.
 *
 * @param downloadUrl - A temporary, unauthenticated download link of the recording
 * @param fetchImpl - The fetch to use, the global one by default
 * @throws DownloadNotFoundError on 404, DownloadUnavailableError on any other download failure,
 *   AnalysisTooLargeError over the size or length limit, AudioDecodeError when ffmpeg rejects the
 *   bytes, AnalysisTooShortError under MIN_DURATION_SECONDS
 * @example
 * const features = await analyzeFromUrl(body.downloadUrl);
 */
export const analyzeFromUrl = async (downloadUrl: string, fetchImpl: Fetch = fetch): Promise<ChromaFeatures> => {
	let response: Awaited<ReturnType<Fetch>>;
	try {
		response = await fetchImpl(downloadUrl);
	} catch (error) {
		throw new DownloadUnavailableError(error);
	}
	if (response.status === 404) throw new DownloadNotFoundError(downloadUrl);
	if (!response.ok) throw new DownloadUnavailableError(response.status);
	const declared = Number(response.headers?.get('content-length') ?? 0);
	if (declared > MAX_DOWNLOAD_BYTES) throw new AnalysisTooLargeError(megabytes(declared));
	const bytes = Buffer.from(await response.arrayBuffer());
	if (bytes.byteLength > MAX_DOWNLOAD_BYTES) throw new AnalysisTooLargeError(megabytes(bytes.byteLength));
	const pcm = await decodeToMonoPcm(bytes, ANALYSIS_SAMPLE_RATE);
	const durationSeconds = pcm.length / ANALYSIS_SAMPLE_RATE;
	if (durationSeconds < MIN_DURATION_SECONDS) throw new AnalysisTooShortError(durationSeconds);
	if (durationSeconds > MAX_DURATION_SECONDS) throw new AnalysisTooLargeError(`${(durationSeconds / 60).toFixed(0)} min`);
	return extractor.extract(pcm, ANALYSIS_SAMPLE_RATE);
};
