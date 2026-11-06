import { onRequest, type Request } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import type { Response } from 'express';
import { analyzeFromUrl } from '../service/analyze-from-url';
import { ensureRecordingFeatures, proposeTrackForRecording } from '../service/proposal.service';
import { getFirebaseAdminApp } from '../util/firebase-admin.util';

type Mode = 'propose' | 'features';

interface AnalyzeBody {
	communityId: string;
	recordingId: string;
	downloadUrl: string;
	mode: Mode;
}

const isId = (value: unknown): value is string => typeof value === 'string' && value !== '' && !value.includes('/');

const parseBody = (body: unknown): AnalyzeBody | null => {
	if (!body || typeof body !== 'object') return null;
	const { communityId, recordingId, downloadUrl, mode } = body as Record<string, unknown>;
	if (!isId(communityId) || !isId(recordingId)) return null;
	if (typeof downloadUrl !== 'string' || !downloadUrl.startsWith('https://')) return null;
	if (mode !== 'propose' && mode !== 'features') return null;
	return { communityId, recordingId, downloadUrl, mode };
};

/**
 * The analysis service: downloads a recording from the temporary URL the closed codebase hands
 * over, extracts its features and, in mode `propose`, compares it with every assigned take of the
 * band and writes the proposal. Private: only principals with the invoker role can call it.
 *
 * @example
 * POST { communityId, recordingId, downloadUrl, mode: 'propose' } → 200 { proposal }
 * POST { ..., mode: 'features' } → 200 { features: { version, frames, durationSeconds } }
 */
export const analyzeRecording = onRequest(
	{ region: 'us-central1', memory: '2GiB', timeoutSeconds: 300, maxInstances: 5, concurrency: 1, invoker: 'private' },
	async (request: Request, response: Response): Promise<void> => {
		if (request.method !== 'POST') {
			response.status(405).send('POST only');
			return;
		}
		const body = parseBody(request.body);
		if (!body) {
			response.status(400).json({ error: 'communityId, recordingId, an https downloadUrl and mode propose or features are required' });
			return;
		}
		const firestore = getFirebaseAdminApp().firestore();
		const deps = { firestore, analyze: (downloadUrl: string) => analyzeFromUrl(downloadUrl), now: Date.now };
		try {
			if (body.mode === 'features') {
				const features = await ensureRecordingFeatures(deps, body.communityId, body.recordingId, body.downloadUrl);
				response.status(200).json({ features: { version: 1, frames: features.frames, durationSeconds: features.durationSeconds } });
				return;
			}
			const proposal = await proposeTrackForRecording(deps, body.communityId, body.recordingId, body.downloadUrl);
			response.status(200).json({ proposal });
		} catch (error) {
			logger.error('analyzeRecording failed', { communityId: body.communityId, recordingId: body.recordingId, mode: body.mode, error });
			response.status(500).json({ error: 'analysis failed' });
		}
	}
);
