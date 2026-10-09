import type { Card, Project } from '../src/types';
export interface DomainDocument {
  path: string;
  title: string;
  mediaType: string;
  content: string;
}
export interface DomainDocuments {
  schemaVersion: number;
  projectId: string;
  contextId: string | null;
  generatedFrom: {
    project: { id: string; revision: number; updatedAt: string };
    cards: { id: string; revision: number; updatedAt: string }[];
    references: { id: string; revision: number; updatedAt: string }[];
  };
  files: DomainDocument[];
}
export function buildDomainDocuments(
  project: Project,
  cards: Card[],
  options?: { contextId?: string },
): DomainDocuments;
