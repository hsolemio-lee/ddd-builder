export type Stage =
  'discovery' | 'events' | 'contexts' | 'aggregates' | 'tasks';
export type Kind =
  | 'problem'
  | 'actor'
  | 'term'
  | 'event'
  | 'command'
  | 'policy'
  | 'question'
  | 'context'
  | 'aggregate'
  | 'task';
export interface User {
  id: string;
  name: string;
}
export interface Project {
  id: string;
  name: string;
  description: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}
export interface Card {
  id: string;
  projectId: string;
  stage: Stage;
  kind: Kind;
  title: string;
  description: string;
  contextId: string | null;
  data: Record<string, string | boolean>;
  position: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}
export type CardDraft = Pick<
  Card,
  'stage' | 'kind' | 'title' | 'description' | 'contextId' | 'data' | 'position'
>;
export interface Workspace {
  projects: Project[];
  cards: Card[];
}
