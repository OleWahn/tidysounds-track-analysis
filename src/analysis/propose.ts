const EPSILON = 1e-9;

/**
 * One track scored against a recording: the similarity of the recording with the track's best recording.
 */
export interface ScoredCandidate {
	trackId: string;
	trackName: string;
	score: number;
}

/**
 * A track the analysis is confident enough to suggest.
 */
export interface ChosenProposal {
	trackId: string;
	trackName: string;
	score: number;
	margin: number;
}

/**
 * Picks the track to propose: the best-scoring candidate, if its score reaches the threshold
 * and it beats the second-best candidate by at least the margin. A single candidate's margin
 * is measured against zero.
 *
 * @param candidates - Scored tracks, in any order
 * @param threshold - Minimum score of the best candidate, 0..1
 * @param margin - Minimum distance of the best candidate to the second-best, 0..1
 * @returns The proposal, or null when no candidate is convincing
 * @example
 * chooseProposal([{ trackId: 'a', trackName: 'Water Cups', score: 0.7 }], 0.5, 0.1);
 * // { trackId: 'a', trackName: 'Water Cups', score: 0.7, margin: 0.7 }
 */
export const chooseProposal = (candidates: ScoredCandidate[], threshold: number, margin: number): ChosenProposal | null => {
	if (candidates.length === 0) return null;
	const ranked = [...candidates].sort((x, y) => y.score - x.score);
	const best = ranked[0];
	const second = ranked.length > 1 ? ranked[1].score : 0;
	const distance = best.score - second;
	if (best.score + EPSILON < threshold || distance + EPSILON < margin) return null;
	return { trackId: best.trackId, trackName: best.trackName, score: best.score, margin: distance };
};
