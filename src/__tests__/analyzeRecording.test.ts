const mockPropose = jest.fn();
const mockEnsure = jest.fn();
const mockAnalyzeFromUrl = jest.fn();
jest.mock('../service/proposal.service', () => ({
	proposeTrackForRecording: (...args: any[]) => mockPropose(...args),
	ensureRecordingFeatures: (...args: any[]) => mockEnsure(...args)
}));
jest.mock('../service/analyze-from-url', () => ({
	analyzeFromUrl: (...args: any[]) => mockAnalyzeFromUrl(...args)
}));
jest.mock('../util/firebase-admin.util', () => ({
	getFirebaseAdminApp: () => ({ firestore: () => ({ app: 'firestore' }) })
}));
jest.mock('firebase-functions/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

import { analyzeRecording } from '../endpoints/analyzeRecording';

const fakeResponse = () => {
	const sent: { status?: number; body?: unknown } = {};
	const res: any = {
		sent,
		status: (code: number) => {
			sent.status = code;
			return res;
		},
		json: (body: unknown) => {
			sent.body = body;
			return res;
		},
		send: (body?: unknown) => {
			sent.body = body;
			return res;
		}
	};
	return res;
};

const handler = analyzeRecording as unknown as (req: any, res: any) => Promise<void>;
const body = { communityId: 'c1', recordingId: 'rec', downloadUrl: 'https://dl.example/rec', mode: 'propose' };
const proposal = { status: 'ready', trackId: 't1', trackName: 'Water Cups', score: 0.9, margin: 0.4, rejectedTrackIds: [], version: 1 };

describe('analyzeRecording', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockPropose.mockResolvedValue(proposal);
		mockEnsure.mockResolvedValue({ extractor: 'essentia', chroma: new Uint8Array(12), frames: 1, durationSeconds: 30 });
	});

	it('proposes a track and answers with the proposal', async () => {
		const res = fakeResponse();

		await handler({ method: 'POST', body }, res);

		expect(res.sent.status).toBe(200);
		expect(res.sent.body).toEqual({ proposal });
		expect(mockPropose).toHaveBeenCalledWith(expect.objectContaining({ analyze: expect.any(Function), now: expect.any(Function) }), 'c1', 'rec', 'https://dl.example/rec');
	});

	it('analyzes through the download URL', async () => {
		const res = fakeResponse();
		await handler({ method: 'POST', body }, res);
		const deps = mockPropose.mock.calls[0][0];
		await deps.analyze('https://dl.example/rec');
		expect(mockAnalyzeFromUrl).toHaveBeenCalledWith('https://dl.example/rec');
	});

	it('only ensures the features in mode features', async () => {
		const res = fakeResponse();

		await handler({ method: 'POST', body: { ...body, mode: 'features' } }, res);

		expect(res.sent.status).toBe(200);
		expect(res.sent.body).toEqual({ features: { version: 1, frames: 1, durationSeconds: 30 } });
		expect(mockEnsure).toHaveBeenCalledWith(expect.anything(), 'c1', 'rec', 'https://dl.example/rec');
		expect(mockPropose).not.toHaveBeenCalled();
	});

	it.each([
		['a missing community', { ...body, communityId: undefined }],
		['a recording id with a slash', { ...body, recordingId: 'a/b' }],
		['a download URL that is not https', { ...body, downloadUrl: 'ftp://x' }],
		['an unknown mode', { ...body, mode: 'guess' }]
	])('answers 400 to %s', async (_label, bad) => {
		const res = fakeResponse();
		await handler({ method: 'POST', body: bad }, res);
		expect(res.sent.status).toBe(400);
		expect(mockPropose).not.toHaveBeenCalled();
	});

	it('answers 405 to anything but POST', async () => {
		const res = fakeResponse();
		await handler({ method: 'GET', body: {} }, res);
		expect(res.sent.status).toBe(405);
	});

	it('answers 500 when the service throws', async () => {
		mockPropose.mockRejectedValue(new Error('firestore down'));
		const res = fakeResponse();
		await handler({ method: 'POST', body }, res);
		expect(res.sent.status).toBe(500);
	});
});
