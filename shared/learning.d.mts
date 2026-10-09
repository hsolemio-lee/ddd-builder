export { documentationGuide } from './documentation-guide.mjs';
import type { FieldExample } from './documentation-guide.mjs';
import type { Stage } from '../src/types';
export type Lesson = {
  goal: string;
  fieldExamples?: FieldExample[];
  concepts: { title: string; body: string }[];
  example: string;
  practice: string[];
  pitfalls: string[];
  review: string[];
  quiz: {
    question: string;
    options: string[];
    answer: number;
    explanation: string;
  };
};

export const lessons: Record<Stage, Lesson>;
export const references: { title: string; url: string; description: string }[];
