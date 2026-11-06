import type { Timestamp } from 'firebase-admin/firestore';

/**
 * Subcollection of a recording that holds the analysis. The TidySounds app and its closed
 * functions read the same documents; this file is the service's own copy of the contract.
 */
export const ANALYSIS_COLLECTION = 'analysis';

/**
 * Document with the track proposal; band members read it and may add rejected tracks.
 */
export const TRACK_PROPOSAL_DOC = 'proposal';

/**
 * Document with the chroma features; never readable by clients.
 */
export const TRACK_FEATURES_DOC = 'features';

export type TrackProposalStatus = 'analyzing' | 'ready' | 'failed';

/**
 * The outcome of comparing a recording with the band's assigned takes.
 * `analyzing` also acts as the lock of the run that set it.
 */
export interface TrackProposal {
	status: TrackProposalStatus;
	startedAt: Timestamp;
	version: number;
	trackId: string | null;
	trackName: string | null;
	score: number | null;
	margin: number | null;
	rejectedTrackIds: string[];
	retryable?: boolean;
	proposedAt?: Timestamp;
}
