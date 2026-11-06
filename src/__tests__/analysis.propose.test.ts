import { FEATURE_VERSION, LOCK_TIMEOUT_MS, MIN_DURATION_SECONDS, PROPOSAL_MARGIN, PROPOSAL_THRESHOLD } from '../analysis/constants';
import { chooseProposal, ScoredCandidate } from '../analysis/propose';

const candidate = (trackId: string, score: number): ScoredCandidate => ({ trackId, trackName: `Track ${trackId}`, score });

describe('chooseProposal', () => {
	it('proposes nothing without candidates', () => {
		expect(chooseProposal([], 0.5, 0.1)).toBeNull();
	});

	it('proposes the best track when it clears the threshold and the margin', () => {
		expect(chooseProposal([candidate('b', 0.4), candidate('a', 0.7)], 0.5, 0.1)).toEqual({
			trackId: 'a',
			trackName: 'Track a',
			score: 0.7,
			margin: expect.closeTo(0.3, 5)
		});
	});

	it('proposes nothing when the second-best is too close', () => {
		expect(chooseProposal([candidate('a', 0.7), candidate('b', 0.65)], 0.5, 0.1)).toBeNull();
	});

	it('proposes nothing when the best is below the threshold', () => {
		expect(chooseProposal([candidate('a', 0.45)], 0.5, 0.1)).toBeNull();
	});

	it('measures the margin of a single candidate against zero', () => {
		expect(chooseProposal([candidate('a', 0.6)], 0.5, 0.1)).toEqual({
			trackId: 'a',
			trackName: 'Track a',
			score: 0.6,
			margin: 0.6
		});
	});

	it('accepts a score exactly at the threshold and a margin exactly at the minimum', () => {
		expect(chooseProposal([candidate('a', 0.5), candidate('b', 0.4)], 0.5, 0.1)?.trackId).toBe('a');
	});
});

describe('analysis constants', () => {
	it('hold the values the spec fixes', () => {
		expect(FEATURE_VERSION).toBe(1);
		expect(MIN_DURATION_SECONDS).toBe(20);
		expect(LOCK_TIMEOUT_MS).toBe(10 * 60 * 1000);
		expect(PROPOSAL_THRESHOLD).toBeGreaterThan(0);
		expect(PROPOSAL_THRESHOLD).toBeLessThanOrEqual(1);
		expect(PROPOSAL_MARGIN).toBeGreaterThanOrEqual(0);
	});
});
