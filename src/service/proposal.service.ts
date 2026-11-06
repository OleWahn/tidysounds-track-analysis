import { FieldValue, Firestore, Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { retryableFailure } from '../errors';
import { ANALYSIS_COLLECTION, TRACK_FEATURES_DOC, TRACK_PROPOSAL_DOC, TrackProposal } from '../types';
import {
	ChromaFeatures,
	chooseProposal,
	extractor,
	FEATURE_VERSION,
	LOCK_TIMEOUT_MS,
	PROPOSAL_MARGIN,
	PROPOSAL_THRESHOLD,
	ScoredCandidate
} from '../analysis';

/**
 * What the proposal service needs from its surroundings: Firestore, the analysis of a recording
 * from its download URL into features, and the clock.
 */
export interface ProposalServiceDeps {
	firestore: Firestore;
	analyze: (downloadUrl: string) => Promise<ChromaFeatures>;
	now: () => number;
}

const analysisDoc = (firestore: Firestore, communityId: string, recordingId: string, doc: string) =>
	firestore.doc(`communities/${communityId}/recordings/${recordingId}/${ANALYSIS_COLLECTION}/${doc}`);

const toBytes = (value: unknown): Uint8Array => {
	if (value instanceof Uint8Array) return Uint8Array.from(value);
	if (value && typeof value === 'object' && 'toUint8Array' in value) return (value as { toUint8Array: () => Uint8Array }).toUint8Array();
	if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) return Uint8Array.from((value as { data: number[] }).data);
	return new Uint8Array(0);
};

const currentFeatures = (stored: Record<string, unknown> | undefined): ChromaFeatures | null => {
	if (!stored || stored.version !== FEATURE_VERSION || stored.extractor !== extractor.id) return null;
	return {
		extractor: extractor.id,
		chroma: toBytes(stored.chroma),
		frames: stored.frames as number,
		durationSeconds: stored.durationSeconds as number
	};
};

/**
 * Returns the stored features of a recording, computing and storing them first when they are
 * missing or were made by an older feature version or another extractor.
 *
 * @param deps - Firestore, the analysis and the clock
 * @param communityId - The band
 * @param recordingId - The recording
 * @param downloadUrl - Where to download the recording from if it has to be analyzed
 * @example
 * const features = await ensureRecordingFeatures(deps, 'c1', 'id:abc', body.downloadUrl);
 */
export const ensureRecordingFeatures = async (deps: ProposalServiceDeps, communityId: string, recordingId: string, downloadUrl: string): Promise<ChromaFeatures> => {
	const ref = analysisDoc(deps.firestore, communityId, recordingId, TRACK_FEATURES_DOC);
	const existing = currentFeatures((await ref.get()).data());
	if (existing) return existing;
	const features = await deps.analyze(downloadUrl);
	await ref.set({
		version: FEATURE_VERSION,
		extractor: features.extractor,
		chroma: Buffer.from(features.chroma),
		frames: features.frames,
		durationSeconds: features.durationSeconds,
		computedAt: Timestamp.fromMillis(deps.now())
	});
	return features;
};

const failureName = (error: unknown): string => (error instanceof Error ? error.name : String(error));

type LockOutcome = { action: 'run'; rejectedTrackIds: string[] } | { action: 'return'; proposal: TrackProposal };

const takeLock = (deps: ProposalServiceDeps, communityId: string, recordingId: string): Promise<LockOutcome> => {
	const ref = analysisDoc(deps.firestore, communityId, recordingId, TRACK_PROPOSAL_DOC);
	return deps.firestore.runTransaction(async (tx) => {
		const snapshot = await tx.get(ref);
		const current = snapshot.exists ? (snapshot.data() as TrackProposal) : null;
		if (current) {
			const startedAt = current.startedAt && typeof (current.startedAt as Timestamp).toMillis === 'function' ? (current.startedAt as Timestamp).toMillis() : 0;
			const fresh = deps.now() - startedAt < LOCK_TIMEOUT_MS;
			if (current.status === 'analyzing' && fresh) return { action: 'return', proposal: current };
			if (current.status === 'failed' && current.retryable === false && current.version === FEATURE_VERSION) return { action: 'return', proposal: current };
		}
		const rejectedTrackIds = current?.rejectedTrackIds ?? [];
		tx.set(ref, {
			status: 'analyzing',
			startedAt: Timestamp.fromMillis(deps.now()),
			version: FEATURE_VERSION,
			trackId: current?.trackId ?? null,
			trackName: current?.trackName ?? null,
			score: current?.score ?? null,
			margin: current?.margin ?? null,
			rejectedTrackIds,
			retryable: FieldValue.delete()
		}, { merge: true });
		return { action: 'run', rejectedTrackIds };
	});
};

interface Take {
	recordingId: string;
	trackId: string;
}

/**
 * The band's assigned, non-archived takes of existing tracks, except the recording itself and
 * the rejected tracks.
 */
const loadTakes = async (deps: ProposalServiceDeps, communityId: string, recordingId: string, rejectedTrackIds: string[]): Promise<{ takes: Take[]; trackNames: Map<string, string> }> => {
	const tracks = await deps.firestore.collection(`communities/${communityId}/tracks`).get();
	const trackNames = new Map(tracks.docs.map((t) => [t.id, String(t.data().name ?? t.id)]));
	const recordings = await deps.firestore.collection(`communities/${communityId}/recordings`).where('track', '>=', '').get();
	const takes: Take[] = [];
	for (const doc of recordings.docs) {
		const data = doc.data();
		const trackId = data.track as string;
		if (doc.id === recordingId || !trackNames.has(trackId) || rejectedTrackIds.includes(trackId)) continue;
		if (data.organizationStatus === 'archived' || data.archivedAt) continue;
		takes.push({ recordingId: doc.id, trackId });
	}
	return { takes, trackNames };
};

const scoreCandidates = async (deps: ProposalServiceDeps, communityId: string, recordingId: string, features: ChromaFeatures, rejectedTrackIds: string[]): Promise<ScoredCandidate[]> => {
	const { takes, trackNames } = await loadTakes(deps, communityId, recordingId, rejectedTrackIds);
	const best = new Map<string, number>();
	let skipped = 0;
	for (const take of takes) {
		const stored = currentFeatures((await analysisDoc(deps.firestore, communityId, take.recordingId, TRACK_FEATURES_DOC).get()).data());
		if (!stored) {
			skipped++;
			continue;
		}
		const score = extractor.compare(features, stored);
		best.set(take.trackId, Math.max(best.get(take.trackId) ?? -1, score));
	}
	if (skipped > 0) logger.info('Takes without current features left out of the comparison', { communityId, recordingId, skipped, compared: takes.length - skipped });
	return [...best.entries()].map(([trackId, score]) => ({ trackId, trackName: trackNames.get(trackId) ?? trackId, score }));
};

/**
 * Analyzes a recording if needed, compares it with every assigned take of each track (a track
 * scores as its best take) and writes the proposal document: `ready` with the proposed track or
 * none, or `failed`. A run that finds a fresh lock, or a permanent failure of the current feature
 * version, returns that state untouched.
 *
 * @param deps - Firestore, the analysis and the clock
 * @param communityId - The band
 * @param recordingId - An unassigned recording of the band
 * @param downloadUrl - Where to download the recording from if it has to be analyzed
 * @returns The proposal as written
 * @example
 * const proposal = await proposeTrackForRecording({ firestore, analyze: analyzeFromUrl, now: Date.now }, 'c1', 'id:abc', url);
 */
export const proposeTrackForRecording = async (deps: ProposalServiceDeps, communityId: string, recordingId: string, downloadUrl: string): Promise<TrackProposal> => {
	const lock = await takeLock(deps, communityId, recordingId);
	if (lock.action === 'return') return lock.proposal;
	const ref = analysisDoc(deps.firestore, communityId, recordingId, TRACK_PROPOSAL_DOC);
	const base = { version: FEATURE_VERSION, rejectedTrackIds: lock.rejectedTrackIds, startedAt: Timestamp.fromMillis(deps.now()) };
	try {
		const features = await ensureRecordingFeatures(deps, communityId, recordingId, downloadUrl);
		const candidates = await scoreCandidates(deps, communityId, recordingId, features, lock.rejectedTrackIds);
		const chosen = chooseProposal(candidates, PROPOSAL_THRESHOLD, PROPOSAL_MARGIN);
		const proposal: TrackProposal = {
			...base,
			status: 'ready',
			trackId: chosen?.trackId ?? null,
			trackName: chosen?.trackName ?? null,
			score: chosen?.score ?? null,
			margin: chosen?.margin ?? null,
			proposedAt: Timestamp.fromMillis(deps.now())
		};
		await ref.set(proposal);
		return proposal;
	} catch (error) {
		const proposal: TrackProposal = { ...base, status: 'failed', retryable: retryableFailure(error), trackId: null, trackName: null, score: null, margin: null };
		logger.warn('Track proposal failed', { communityId, recordingId, error: failureName(error), retryable: proposal.retryable });
		await ref.set(proposal);
		return proposal;
	}
};
