import type { Card } from '../src/types';
export interface ContextDirection {
  flows: { source: string; target: string }[];
  declared: boolean;
}
export interface ContextConnection {
  id: string;
  source: string;
  target: string;
  forward: ContextDirection;
  reverse: ContextDirection;
}
export interface ContextGroup {
  context: Card;
  members: Card[];
}
export function buildContextMap(
  contexts: Card[],
  members: Card[],
): {
  groups: ContextGroup[];
  connections: ContextConnection[];
  unassigned: Card[];
};
export function layoutContextMap(
  groups: ContextGroup[],
  connections: ContextConnection[],
  options?: {
    width?: number;
    positions?: Record<string, { x: number; y: number }>;
  },
): {
  nodes: { id: string; x: number; y: number }[];
  edges: (ContextConnection & {
    path: string;
    labelX: number;
    labelY: number;
  })[];
  width: number;
  height: number;
};
