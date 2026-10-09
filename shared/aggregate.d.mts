import type { z } from 'zod';
import type {
  Card,
  AggregateDesign,
  AggregateRule,
  AggregateExample,
  Stage,
} from '../src/types';
export const aggregateDesignSchema: z.ZodType<AggregateDesign>;
export const aggregatePatchSchema: z.ZodType;
export const exampleSchema: z.ZodType<AggregateExample>;
export const ruleSchema: z.ZodType<AggregateRule>;
export function aggregateDesignOf(
  card: Pick<Card, 'aggregateDesign'>,
): AggregateDesign;
export function validateAggregateDesign(
  raw: unknown,
  card: Card,
  cards: Card[],
): AggregateDesign;
export function patchAggregateDesign(
  card: Card,
  patch: unknown,
): AggregateDesign;
export function removeAggregateReference(
  card: Card,
  removedId: string,
): AggregateDesign | undefined;
export function aggregateReview(
  card: Card,
  cards: Card[],
): { cardId: string; stage: Stage; code: string; message: string }[];
export function buildAggregateDesign(
  card: Card,
  cards: Card[],
): {
  aggregate: Card;
  context: Card | null;
  design: AggregateDesign;
  commands: {
    id: string;
    card: Card | null;
    ruleIds: string[];
    resultEvents: Card[];
  }[];
  externalReferences: {
    aggregateId: string;
    reason: string;
    aggregate: Card | null;
  }[];
  incomingReferences: { id: string; title: string; contextId: string | null }[];
  issues: ReturnType<typeof aggregateReview>;
  note: string;
};
