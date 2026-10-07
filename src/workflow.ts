import { Compass, Zap, Network, Blocks, ListChecks } from 'lucide-react';
import type { Kind, Stage } from './types';

export const steps = [
  {
    id: 'discovery',
    title: '도메인 탐색',
    english: 'DOMAIN DISCOVERY',
    icon: Compass,
    headline: '우리가 풀고 싶은 문제는 무엇인가요?',
    description:
      '사용자의 이야기에서 출발해, 문제와 함께 사용할 언어를 발견해요.',
    tip: '기술보다 문제를 먼저 이야기해요. 같은 단어를 서로 같은 의미로 쓰고 있는지도 확인해 보세요.',
    kinds: ['problem', 'actor', 'term'],
  },
  {
    id: 'events',
    title: '이벤트 정리',
    english: 'EVENT STORMING',
    icon: Zap,
    headline: '일어나는 일부터, 이야기해요.',
    description:
      '도메인에서 일어나는 사건을 꺼내 놓고, 그 앞뒤의 흐름을 함께 연결해요.',
    tip: '이벤트는 “주문이 접수되었다”처럼 과거형으로 써 보세요. 아직 답이 없는 질문도 좋은 출발점이에요.',
    kinds: ['event', 'command', 'actor', 'policy', 'question'],
  },
  {
    id: 'contexts',
    title: '컨텍스트 나누기',
    english: 'BOUNDED CONTEXTS',
    icon: Network,
    headline: '함께 움직이는 것들의 경계를 찾아요.',
    description:
      '각 영역의 책임을 정하고, 이벤트를 적절한 컨텍스트에 모아 보세요.',
    tip: '같은 “상품”이라도 주문과 배송에서 필요한 정보가 다를 수 있어요. 의미가 바뀌는 곳에 경계를 그어 보세요.',
    kinds: ['context'],
  },
  {
    id: 'aggregates',
    title: '애그리게이트 설계',
    english: 'AGGREGATE DESIGN',
    icon: Blocks,
    headline: '함께 지켜야 할 규칙을 모아요.',
    description:
      '일관성을 유지할 단위와, 그 안에서 반드시 지켜야 할 규칙을 설계해요.',
    tip: '“결제한 주문만 배송할 수 있다”처럼 항상 지켜야 할 규칙부터 적으면 애그리게이트의 경계가 선명해져요.',
    kinds: ['aggregate'],
  },
  {
    id: 'tasks',
    title: '구현 체크리스트',
    english: 'READY TO BUILD',
    icon: ListChecks,
    headline: '우리의 설계를 다음 행동으로.',
    description:
      '설계 내용을 작은 구현 작업으로 나누고, 담당자와 완료 상태를 함께 관리해요.',
    tip: '한 번에 확인할 수 있는 작은 작업으로 나눠 보세요. 구현하면서 발견한 내용은 앞 단계에 돌아가 반영할 수 있어요.',
    kinds: ['task'],
  },
] satisfies {
  id: Stage;
  title: string;
  english: string;
  icon: typeof Compass;
  headline: string;
  description: string;
  tip: string;
  kinds: Kind[];
}[];

export const kinds: Record<
  Kind,
  { label: string; description: string; placeholder: string; color: string }
> = {
  problem: {
    label: '해결할 문제',
    description: '왜 이 서비스가 필요한가요?',
    placeholder: '고객은 주문 상태를 확인하기 어렵다',
    color: 'coral',
  },
  actor: {
    label: '행위자',
    description: '누가 행동을 시작하나요?',
    placeholder: '주문하는 고객',
    color: 'yellow',
  },
  term: {
    label: '공통 용어',
    description: '함께 사용할 언어',
    placeholder: '주문: 고객의 구매 의사와 상품 목록',
    color: 'green',
  },
  event: {
    label: '도메인 이벤트',
    description: '이미 일어난 의미 있는 사건',
    placeholder: '주문이 접수되었다',
    color: 'orange',
  },
  command: {
    label: '명령',
    description: '사건을 일으키는 요청',
    placeholder: '주문을 접수한다',
    color: 'blue',
  },
  policy: {
    label: '정책',
    description: '사건 이후의 규칙과 반응',
    placeholder: '결제가 완료되면 배송을 요청한다',
    color: 'purple',
  },
  question: {
    label: '미해결 질문',
    description: '함께 더 이야기할 내용',
    placeholder: '품절일 때 주문은 어떻게 처리할까?',
    color: 'pink',
  },
  context: {
    label: '바운디드 컨텍스트',
    description: '하나의 언어와 책임을 가진 영역',
    placeholder: '주문 관리',
    color: 'green',
  },
  aggregate: {
    label: '애그리게이트',
    description: '함께 일관성을 지키는 단위',
    placeholder: '주문',
    color: 'blue',
  },
  task: {
    label: '구현 작업',
    description: '설계를 구체적인 행동으로',
    placeholder: '주문 접수 유스케이스 구현',
    color: 'green',
  },
};

export const hints: Record<Stage, string[]> = {
  discovery: [
    '해결하려는 문제가 한 문장으로 설명되나요?',
    '주요 사용자와 공통 용어를 정리했나요?',
  ],
  events: [
    '이벤트를 과거형으로 표현했나요?',
    '누가 어떤 명령으로 사건을 일으키는지 알 수 있나요?',
  ],
  contexts: [
    '각 컨텍스트의 책임이 분명한가요?',
    '미분류 이벤트에 속할 곳을 정했나요?',
  ],
  aggregates: [
    '애그리게이트 루트가 정해졌나요?',
    '항상 지켜야 할 규칙을 적었나요?',
  ],
  tasks: [
    '작업을 작게 나누고 담당자를 정했나요?',
    '완료를 확인할 기준이 구체적인가요?',
  ],
};
