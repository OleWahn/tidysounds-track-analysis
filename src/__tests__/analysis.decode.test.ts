import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AudioDecodeError } from '../../../shared/custom-errors';
import { ANALYSIS_SAMPLE_RATE } from '../analysis/constants';
import { decodeToMonoPcm } from '../analysis/decode';

const FORMATS = ['wav', 'mp3', 'm4a'] as const;
const DURATION_SECONDS = 3;

describe('decodeToMonoPcm', () => {
	let dir: string;

	/**
	 * Returns the path of a generated 3 s sine tone in the given format.
	 *
	 * @param ext - File extension, one of wav, mp3, m4a
	 * @example
	 * fs.readFileSync(fixture('mp3'));
	 */
	const fixture = (ext: string): string => path.join(dir, `tone.${ext}`);

	beforeAll(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidysounds-decode-'));
		const ffmpeg = require('ffmpeg-static') as string;
		for (const ext of FORMATS) {
			execFileSync(ffmpeg, [
				'-y', '-loglevel', 'error',
				'-f', 'lavfi', '-i', `sine=frequency=440:duration=${DURATION_SECONDS}`,
				fixture(ext)
			]);
		}
	});

	afterAll(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it.each(FORMATS)('decodes %s to 22.05 kHz mono', async (ext) => {
		const pcm = await decodeToMonoPcm(fs.readFileSync(fixture(ext)));
		expect(pcm).toBeInstanceOf(Float32Array);
		expect(pcm.length).toBeGreaterThan(ANALYSIS_SAMPLE_RATE * 2.9);
		expect(pcm.length).toBeLessThan(ANALYSIS_SAMPLE_RATE * 3.2);
		expect(Math.max(...pcm.subarray(0, ANALYSIS_SAMPLE_RATE))).toBeGreaterThan(0.1);
	});

	it('decodes at the sample rate it is given', async () => {
		const pcm = await decodeToMonoPcm(fs.readFileSync(fixture('wav')), 8000);
		expect(pcm.length).toBeGreaterThan(8000 * 2.9);
		expect(pcm.length).toBeLessThan(8000 * 3.2);
	});

	it('rejects bytes that are not audio', async () => {
		await expect(decodeToMonoPcm(Buffer.from('not audio'))).rejects.toBeInstanceOf(AudioDecodeError);
	});
});
