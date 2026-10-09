import type { Card } from '../src/types';
export function layoutFlow(
  cards: Card[],
  options?: { width?: number; direction?: 'auto' | 'horizontal' | 'vertical' },
): {
  direction: 'horizontal' | 'vertical';
  nodes: { id: string; x: number; y: number }[];
  edges: { source: string; target: string; feedback: boolean; path: string }[];
  width: number;
  height: number;
  unconnected: string[];
};
