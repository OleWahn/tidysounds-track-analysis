import { spawn } from 'child_process';
import { AudioDecodeError } from '../errors';
import { ANALYSIS_SAMPLE_RATE } from './constants';

const STDERR_TAIL_LENGTH = 400;

/**
 * Decodes an audio file (mp3, m4a, wav or anything else ffmpeg reads) to mono
 * 32-bit float PCM at the given sample rate, using the ffmpeg binary that
 * `ffmpeg-static` ships as a separate process.
 *
 * @param input - The complete audio file
 * @param sampleRate - Target sample rate in Hz, ANALYSIS_SAMPLE_RATE by default
 * @returns The samples, one float per sample, in the range -1..1
 * @throws AudioDecodeError when ffmpeg cannot decode the input
 * @example
 * const pcm = await decodeToMonoPcm(await provider.download({ id }));
 */
export const decodeToMonoPcm = (input: Buffer, sampleRate: number = ANALYSIS_SAMPLE_RATE): Promise<Float32Array> =>
	new Promise((resolve, reject) => {
		const ffmpeg = require('ffmpeg-static') as string;
		const child = spawn(ffmpeg, [
			'-loglevel', 'error',
			'-i', 'pipe:0',
			'-ac', '1',
			'-ar', String(sampleRate),
			'-f', 'f32le',
			'pipe:1'
		]);
		const chunks: Buffer[] = [];
		let stderr = '';
		child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
		child.stderr.on('data', (chunk: Buffer) => {
			stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL_LENGTH);
		});
		child.on('error', (error) => reject(new AudioDecodeError(error.message)));
		child.on('close', (code) => {
			if (code !== 0) {
				reject(new AudioDecodeError(stderr.trim() || `ffmpeg exited with code ${code}`));
				return;
			}
			const bytes = Buffer.concat(chunks);
			const aligned = bytes.byteLength - (bytes.byteLength % Float32Array.BYTES_PER_ELEMENT);
			const pcm = new Float32Array(aligned / Float32Array.BYTES_PER_ELEMENT);
			Buffer.from(pcm.buffer).set(bytes.subarray(0, aligned));
			resolve(pcm);
		});
		child.stdin.on('error', () => undefined);
		child.stdin.end(input);
	});
