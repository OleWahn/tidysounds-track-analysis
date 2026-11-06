import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AnalysisTooLargeError, AnalysisTooShortError, DownloadNotFoundError, DownloadUnavailableError } from '../errors';
import { analyzeFromUrl } from '../service/analyze-from-url';

const respond = (status: number, body?: Buffer) =>
	jest.fn(async () => ({ ok: status >= 200 && status < 300, status, arrayBuffer: async () => (body ?? Buffer.alloc(0)).buffer.slice((body ?? Buffer.alloc(0)).byteOffset, (body ?? Buffer.alloc(0)).byteOffset + (body ?? Buffer.alloc(0)).byteLength) }));

/**
 * Generates a sine tone of the given length as a wav file and returns its bytes.
 *
 * @param seconds - Length of the tone
 * @example
 * const wav = tone(25);
 */
const tone = (seconds: number): Buffer => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidysounds-url-'));
	const file = path.join(dir, 'tone.wav');
	execFileSync(require('ffmpeg-static') as string, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`, file]);
	const bytes = fs.readFileSync(file);
	fs.rmSync(dir, { recursive: true, force: true });
	return bytes;
};

describe('analyzeFromUrl', () => {
	it('downloads, decodes and extracts features', async () => {
		const fetch = respond(200, tone(25));

		const features = await analyzeFromUrl('https://dl.example/rec', fetch as any);

		expect(fetch).toHaveBeenCalledWith('https://dl.example/rec');
		expect(features.extractor).toBe('essentia');
		expect(features.frames).toBeGreaterThan(0);
		expect(features.durationSeconds).toBeCloseTo(25, 0);
	});

	it('rejects a recording shorter than the minimum', async () => {
		await expect(analyzeFromUrl('https://dl.example/short', respond(200, tone(5)) as any)).rejects.toBeInstanceOf(AnalysisTooShortError);
	});

	it('maps 404 to a missing file', async () => {
		await expect(analyzeFromUrl('https://dl.example/gone', respond(404) as any)).rejects.toBeInstanceOf(DownloadNotFoundError);
	});

	it('refuses a file that declares itself larger than the limit, for good', async () => {
		const fetch = jest.fn(async () => ({ ok: true, status: 200, headers: { get: (name: string) => (name === 'content-length' ? String(200 * 1024 * 1024) : null) }, arrayBuffer: async () => new ArrayBuffer(0) }));
		await expect(analyzeFromUrl('https://dl.example/huge', fetch as any)).rejects.toBeInstanceOf(AnalysisTooLargeError);
		await expect(analyzeFromUrl('https://dl.example/huge', fetch as any)).rejects.toMatchObject({ retryable: false });
	});

	it('refuses a recording longer than the limit, for good', async () => {
		await expect(analyzeFromUrl('https://dl.example/long', respond(200, tone(21 * 60)) as any)).rejects.toBeInstanceOf(AnalysisTooLargeError);
	});

	it('maps other failures to unavailable', async () => {
		await expect(analyzeFromUrl('https://dl.example/down', respond(503) as any)).rejects.toBeInstanceOf(DownloadUnavailableError);
		const broken = jest.fn(async () => { throw new Error('socket hang up'); });
		await expect(analyzeFromUrl('https://dl.example/down', broken as any)).rejects.toBeInstanceOf(DownloadUnavailableError);
	});
});
