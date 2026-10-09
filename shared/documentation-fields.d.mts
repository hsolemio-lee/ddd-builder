import type { Kind } from '../src/types';
export interface DocumentationField {
  key: string;
  label: string;
  help: string;
  example: string;
}
export const documentationFields: Partial<Record<Kind, DocumentationField[]>>;
export const ruleFields: (DocumentationField & {
  key:
    | 'scope'
    | 'condition'
    | 'violation'
    | 'exceptions'
    | 'unresolved'
    | 'source';
})[];
export const documentationKeys: Partial<Record<Kind, string[]>>;
