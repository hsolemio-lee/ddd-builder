import type { Card } from '../src/types';
export function layoutFlow(cards: Card[]): {
  nodes: { id: string; x: number; y: number }[];
  edges: { source: string; target: string; feedback: boolean }[];
  width: number;
  height: number;
  unconnected: string[];
};
