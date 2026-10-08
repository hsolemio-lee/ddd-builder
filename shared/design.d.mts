import type { Card, Stage } from '../src/types';
export const statuses: Record<'hypothesis' | 'proposed' | 'agreed', string>;
export const scenarios: Record<'shared' | 'main' | 'exception', string>;
export const linkKinds: Record<'flow' | 'related' | 'dependsOn', string>;
export function flowAllowed(
  source: Pick<Card, 'stage' | 'kind'>,
  target: Pick<Card, 'stage' | 'kind'>,
): boolean;
export function normalizeCard(card: Card): Card;
export function reviewBoard(cards: Card[]): {
  issues: { cardId: string; stage: Stage; code: string; message: string }[];
  counts: Record<'hypothesis' | 'proposed' | 'agreed', number>;
  unansweredQuestions: number;
  note: string;
};
