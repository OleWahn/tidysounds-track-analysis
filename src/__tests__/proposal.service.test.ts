import { Timestamp } from 'firebase-admin/firestore';
import {
	AnalysisTooShortError,
	AudioDecodeError,
	StorageNotFoundError,
	StorageUnavailableError
} from '../../../shared/custom-errors';
import { FEATURE_VERSION, LOCK_TIMEOUT_MS } from '../analysis/constants';
import { ChromaFeatures } from '../analysis/extractor';
import { ensureRecordingFeatures, proposeTrackForRecording, ProposalServiceDeps } from '../service/proposal.service';
import { chordSequence, stretch } from './analysis/chromaFixtures';
import { memoryFirestore } from './support/memoryFirestore';

const NOW = Date.UTC(2026, 10, 6, 12);
const URL = 'https://dl.example/rec';
const SONG = chordSequence(1, 60);
const OTHER = chordSequence(2, 60);

const features = (chroma: Uint8Array): ChromaFeatures => ({ extractor: 'essentia', chroma, frames: chroma.length / 12, durationSeconds: chroma.length / 24 });

const AUDIO: Record<string, ChromaFeatures> = {
	rec: features(SONG),
	take1: features(stretch(SONG, 1.1)),
	take2: features(stretch(SONG, 0.9)),
	other1: features(OTHER)
};

const stored = (recordingId: string, version = FEATURE_VERSION, extractor = 'essentia') => ({
	version,
	extractor,
	chroma: Buffer.from(AUDIO[recordingId].chroma),
	frames: AUDIO[recordingId].frames,
	durationSeconds: AUDIO[recordingId].durationSeconds,
	computedAt: Timestamp.fromMillis(NOW - 1000)
});

const seed = (): Record<string, any> => ({
	'communities/c1': { name: 'Die Band', trackProposalsEnabled: true },
	'communities/c1/tracks/t1': { name: 'Water Cups' },
	'communities/c1/tracks/t2': { name: 'Other Song' },
	'communities/c1/tracks/t3': { name: 'No Takes Yet' },
	'communities/c1/recordings/rec': { name: 'rec.mp3', path: '/rec.mp3', track: null },
	'communities/c1/recordings/take1': { name: 'take1.mp3', path: '/take1.mp3', track: 't1' },
	'communities/c1/recordings/take1/analysis/features': stored('take1'),
	'communities/c1/recordings/take2': { name: 'take2.mp3', path: '/take2.mp3', track: 't1' },
	'communities/c1/recordings/take2/analysis/features': stored('take2'),
	'communities/c1/recordings/other1': { name: 'other1.mp3', path: '/other1.mp3', track: 't2' },
	'communities/c1/recordings/other1/analysis/features': stored('other1')
});

const setup = (docs: Record<string, any> = seed(), failure?: Error) => {
	const analyze = jest.fn(async (_downloadUrl: string) => {
		if (failure) throw failure;
		return AUDIO.rec;
	});
	const memory = memoryFirestore(docs);
	const deps: ProposalServiceDeps = { firestore: memory.firestore as any, analyze, now: () => NOW };
	return { ...memory, analyze, deps };
};

const proposalOf = (docs: Map<string, any>) => docs.get('communities/c1/recordings/rec/analysis/proposal');

describe('proposeTrackForRecording', () => {
	it('analyzes the recording from its download URL and proposes the track of the best-matching take', async () => {
		const { deps, docs, analyze } = setup();

		const result = await proposeTrackForRecording(deps, 'c1', 'rec', URL);

		expect(analyze).toHaveBeenCalledWith(URL);
		expect(result).toMatchObject({ status: 'ready', trackId: 't1', trackName: 'Water Cups', version: FEATURE_VERSION, rejectedTrackIds: [] });
		expect(result.score).toBeGreaterThan(0.5);
		expect(proposalOf(docs)).toMatchObject({ status: 'ready', trackId: 't1' });
		expect(docs.get('communities/c1/recordings/rec/analysis/features')).toMatchObject({ version: FEATURE_VERSION, extractor: 'essentia', frames: 60 });
	});

	it('scores a track by its best take', async () => {
		const { deps } = setup({
			...seed(),
			'communities/c1/recordings/take1/analysis/features': stored('other1'),
			'communities/c1/recordings/take2/analysis/features': stored('take2')
		});

		const result = await proposeTrackForRecording(deps, 'c1', 'rec', URL);

		expect(result.trackId).toBe('t1');
	});

	it('leaves out takes without current features instead of failing', async () => {
		const docs = seed();
		delete docs['communities/c1/recordings/take1/analysis/features'];
		docs['communities/c1/recordings/take2/analysis/features'] = stored('take2', FEATURE_VERSION - 1);
		const { deps, analyze } = setup(docs);

		const result = await proposeTrackForRecording(deps, 'c1', 'rec', URL);

		expect(result.status).toBe('ready');
		expect(result.trackId).not.toBe('t1');
		expect(analyze).toHaveBeenCalledTimes(1);
	});

	it('ignores archived takes and takes of deleted tracks', async () => {
		const { deps } = setup({
			...seed(),
			'communities/c1/recordings/take1': { name: 'take1.mp3', path: '/take1.mp3', track: 't1', organizationStatus: 'archived' },
			'communities/c1/recordings/take2': { name: 'take2.mp3', path: '/take2.mp3', track: 'gone' }
		});

		const result = await proposeTrackForRecording(deps, 'c1', 'rec', URL);

		expect(result.trackId).not.toBe('t1');
	});

	it('reuses stored features of the current version without downloading', async () => {
		const { deps, analyze } = setup({ ...seed(), 'communities/c1/recordings/rec/analysis/features': stored('rec') });

		const result = await proposeTrackForRecording(deps, 'c1', 'rec', URL);

		expect(result.trackId).toBe('t1');
		expect(analyze).not.toHaveBeenCalled();
	});

	it('recomputes features of another extractor or an older version', async () => {
		const { deps, analyze } = setup({ ...seed(), 'communities/c1/recordings/rec/analysis/features': stored('rec', FEATURE_VERSION, 'meyda') });

		await proposeTrackForRecording(deps, 'c1', 'rec', URL);

		expect(analyze).toHaveBeenCalledTimes(1);
	});

	it('returns the current state while another run holds a fresh lock', async () => {
		const { deps, analyze } = setup({
			...seed(),
			'communities/c1/recordings/rec/analysis/proposal': { status: 'analyzing', startedAt: Timestamp.fromMillis(NOW - 5 * 60 * 1000), version: FEATURE_VERSION, rejectedTrackIds: [] }
		});

		const result = await proposeTrackForRecording(deps, 'c1', 'rec', URL);

		expect(result.status).toBe('analyzing');
		expect(analyze).not.toHaveBeenCalled();
	});

	it('takes over a lock older than the timeout', async () => {
		const { deps } = setup({
			...seed(),
			'communities/c1/recordings/rec/analysis/proposal': { status: 'analyzing', startedAt: Timestamp.fromMillis(NOW - LOCK_TIMEOUT_MS - 1000), version: FEATURE_VERSION, rejectedTrackIds: [] }
		});

		const result = await proposeTrackForRecording(deps, 'c1', 'rec', URL);

		expect(result.status).toBe('ready');
	});

	it('never compares a take with itself', async () => {
		const { deps } = setup({ ...seed(), 'communities/c1/recordings/take1': { name: 'take1.mp3', path: '/take1.mp3', track: null } });

		const result = await proposeTrackForRecording(deps, 'c1', 'take1', URL);

		expect(result.status).toBe('ready');
	});

	it('skips rejected tracks and keeps the rejections', async () => {
		const { deps, docs } = setup({
			...seed(),
			'communities/c1/recordings/rec/analysis/proposal': { status: 'ready', trackId: 't1', trackName: 'Water Cups', score: 0.9, margin: 0.5, version: FEATURE_VERSION, rejectedTrackIds: ['t1'] }
		});

		const result = await proposeTrackForRecording(deps, 'c1', 'rec', URL);

		expect(result.trackId).not.toBe('t1');
		expect(result.rejectedTrackIds).toEqual(['t1']);
		expect(proposalOf(docs).rejectedTrackIds).toEqual(['t1']);
	});

	it.each([
		['a download that is temporarily unavailable', new StorageUnavailableError('download'), true],
		['a download that answers not found', new StorageNotFoundError({ id: URL }), false],
		['undecodable audio', new AudioDecodeError('Invalid data'), false],
		['a recording that is too short', new AnalysisTooShortError(12), false],
		['an unexpected error', new Error('boom'), true]
	])('marks the proposal failed after %s', async (_label, error, retryable) => {
		const { deps, docs } = setup(seed(), error as Error);

		const result = await proposeTrackForRecording(deps, 'c1', 'rec', URL);

		expect(result).toMatchObject({ status: 'failed', retryable, trackId: null });
		expect(proposalOf(docs)).toMatchObject({ status: 'failed', retryable });
	});

	it('returns a permanent failure of the current version without analyzing again', async () => {
		const { deps, analyze } = setup({
			...seed(),
			'communities/c1/recordings/rec/analysis/proposal': { status: 'failed', retryable: false, version: FEATURE_VERSION, startedAt: Timestamp.fromMillis(NOW - 1000), rejectedTrackIds: [] }
		});

		const result = await proposeTrackForRecording(deps, 'c1', 'rec', URL);

		expect(result.status).toBe('failed');
		expect(analyze).not.toHaveBeenCalled();
	});

	it('proposes nothing when no take has features', async () => {
		const { deps } = setup({
			'communities/c1': { name: 'Die Band' },
			'communities/c1/tracks/t3': { name: 'No Takes Yet' },
			'communities/c1/recordings/rec': { name: 'rec.mp3', path: '/rec.mp3', track: null }
		});

		const result = await proposeTrackForRecording(deps, 'c1', 'rec', URL);

		expect(result).toMatchObject({ status: 'ready', trackId: null, trackName: null, score: null, margin: null });
	});
});

describe('ensureRecordingFeatures', () => {
	it('stores freshly computed features', async () => {
		const { deps, docs, analyze } = setup();

		const result = await ensureRecordingFeatures(deps, 'c1', 'rec', URL);

		expect(result.frames).toBe(AUDIO.rec.frames);
		expect(analyze).toHaveBeenCalledWith(URL);
		expect(docs.get('communities/c1/recordings/rec/analysis/features')).toMatchObject({ version: FEATURE_VERSION, extractor: 'essentia', frames: AUDIO.rec.frames });
	});

	it('returns stored features without analyzing', async () => {
		const { deps, analyze } = setup({ ...seed(), 'communities/c1/recordings/rec/analysis/features': stored('rec') });

		const result = await ensureRecordingFeatures(deps, 'c1', 'rec', URL);

		expect(Array.from(result.chroma)).toEqual(Array.from(AUDIO.rec.chroma));
		expect(analyze).not.toHaveBeenCalled();
	});
});
