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
export type ProjectRole = 'admin' | 'editor' | 'viewer';
export interface User {
  email?: string;
  siteAdmin?: boolean;
  id: string;
  name: string;
}
export interface Project {
  role?: ProjectRole;
  id: string;
  name: string;
  description: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}
export type AgreementStatus = 'hypothesis' | 'proposed' | 'agreed';
export type Scenario = 'shared' | 'main' | 'exception';
export interface CardLink {
  targetId: string;
  kind: 'flow' | 'related' | 'dependsOn';
}
export interface AggregateExample {
  id: string;
  title: string;
  type: 'normal' | 'rejection' | 'boundary' | 'concurrency';
  given: string;
  when: string;
  then: string;
  testReferences?: string;
}
export interface AggregateRule {
  id: string;
  statement: string;
  status?: AgreementStatus | 'retired';
  scope?: string;
  condition?: string;
  violation?: string;
  exceptions?: string;
  unresolved?: string;
  source?: string;
  commandIds: string[];
  examples: AggregateExample[];
}
export interface AggregateDesign {
  commandIds: string[];
  rules: AggregateRule[];
  externalReferences: { aggregateId: string; reason: string }[];
  coordination: string;
}
export interface Card {
  status: AgreementStatus;
  decision: string;
  scenario: Scenario;
  links: CardLink[];
  id: string;
  projectId: string;
  stage: Stage;
  kind: Kind;
  title: string;
  description: string;
  contextId: string | null;
  data: Record<string, string | boolean>;
  aggregateDesign?: AggregateDesign;
  position: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}
export type CardDraft = Pick<
  Card,
  | 'stage'
  | 'kind'
  | 'title'
  | 'description'
  | 'contextId'
  | 'data'
  | 'position'
  | 'status'
  | 'decision'
  | 'scenario'
  | 'links'
  | 'aggregateDesign'
>;
export interface Workspace {
  projects: Project[];
  cards: Card[];
}
