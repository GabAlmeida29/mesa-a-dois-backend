export const SCORE_FIELDS = [
  'scoreFood',
  'scoreService',
  'scoreAmbience',
  'scoreCleanliness',
  'scoreComfort',
  'scoreValue',
  'scoreWait',
] as const;

export type ScoreField = (typeof SCORE_FIELDS)[number];
