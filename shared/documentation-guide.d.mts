export interface FieldExample {
  label: string;
  help: string;
  example: string;
}
export const aggregateFieldExamples: FieldExample[];
export const documentationGuide: {
  goal: string;
  principle: string;
  files: { path: string; purpose: string }[];
  workflow: string[];
  review: string[];
  example: {
    note: string;
    ruleId: string;
    status: string;
    context: string;
    aggregate: string;
    statement: string;
    scope: string;
    condition: string;
    violation: string;
    exceptions: string;
    unresolved: string;
    scenario: {
      title: string;
      type: string;
      given: string;
      when: string;
      then: string;
    };
  };
};
