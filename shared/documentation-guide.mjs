import { documentationFields, ruleFields } from './documentation-fields.mjs';

export const documentationGuide = {
  goal: 'AI가 업무 의미와 경계를 유지하도록 컨텍스트별 책임·용어·규칙·관찰 가능한 사례를 전달합니다.',
  principle:
    '이 구성은 실무용 작성 제안이며 검증된 표준이나 AI 정확도 보장이 아닙니다. 보드를 원본으로 관리하고 필요한 문서만 읽습니다.',
  files: [
    {
      path: 'AGENTS.md',
      purpose: '문서 위치, 작업별 읽기 기준, 변경과 검증 지침',
    },
    {
      path: 'docs/domain/index.md',
      purpose: '컨텍스트별 문서 목록과 읽는 순서',
    },
    {
      path: 'docs/domain/context-map.md',
      purpose:
        '기록된 관계 방향과 연동 계약. 관계만으로 소유권을 추측하지 않음',
    },
    {
      path: 'docs/domain/context-{id}/context.md',
      purpose: '목적, 책임, 책임 밖의 일, 소유권, 외부 의존성',
    },
    {
      path: 'docs/domain/context-{id}/glossary.md',
      purpose: '정의, 코드명, 구별 사례, 혼동 용어, 출처',
    },
    {
      path: 'docs/domain/context-{id}/rules.md',
      purpose: '규칙 ID, 적용 범위·조건, 위반 결과, 예외·대안, 미결정 사항',
    },
    {
      path: 'docs/domain/context-{id}/scenarios.md',
      purpose: '규칙과 연결한 정상·거절·경계값·동시성 Given/When/Then',
    },
    {
      path: 'docs/domain/context-{id}/aggregates.md',
      purpose: '루트, 구성 요소, 명령, 상태 전이, 트랜잭션 경계, 외부 조정',
    },
    {
      path: 'docs/domain/context-{id}/implementation.md',
      purpose: '명령과 결과 사건, 구현 과제, 완료 확인 기준, 질문과 추가 기록',
    },
    {
      path: 'docs/domain/unassigned.md',
      purpose: '프로젝트 전체 내보내기에 포함하는 미분류 카드와 탐색 기록',
    },
    {
      path: 'docs/domain/document-data.json',
      purpose: '설명 문서와 같은 원본 데이터, 안정적인 ID와 revision',
    },
    {
      path: 'docs/adr/index.md',
      purpose: 'ADR 작성 안내. 합의된 카드를 완성된 ADR로 자동 변환하지 않음',
    },
  ],
  workflow: [
    '한 기능과 컨텍스트로 범위를 좁히고 책임·용어·규칙·정상/실패 사례부터 기록합니다.',
    '가정과 미결정 사항을 구분하고 업무 담당자가 의미와 규칙을 확인합니다.',
    '결과 내보내기에서 컨텍스트를 선택하고 생성 문서를 미리 본 뒤 ZIP으로 받습니다.',
    'MCP get_domain_documents로 index.md부터 읽고 contextId와 path로 필요한 문서를 선택합니다.',
    '기존 코드와 문서를 함께 확인하고 작은 구현 단위로 규칙과 관찰 결과를 검증합니다.',
    '발견한 차이를 원본 보드에 반영하고 문서를 다시 생성합니다. 생성 문서는 별도 원본으로 중복 편집하지 않습니다.',
  ],
  review: [
    '같은 컨텍스트의 용어 의미와 코드명이 일관적인가요?',
    '규칙의 대상·조건·예외·위반 결과와 미결정 사항이 구분되나요?',
    '실패 시 기존 상태와 이벤트가 어떻게 되는지 관찰할 수 있나요?',
    '규칙 ID에서 사례와 실제 테스트 위치로 연결할 수 있나요?',
    '문서의 의도와 현재 구현·테스트 실행 결과를 구분하나요?',
  ],
  example: {
    note: '아래 생산계획 정책은 가상의 작성 예시이며 실제 요구사항이나 확정된 정책이 아닙니다.',
    ruleId: 'PLAN-001',
    status: 'proposed',
    context: '생산계획',
    aggregate: 'ProductionPlan',
    statement: '확정된 생산계획의 수량을 직접 변경할 수 없다.',
    scope: 'ProductionPlan의 계획 수량 직접 변경',
    condition: '계획 상태가 CONFIRMED이다.',
    violation: '변경 요청을 거절하고 기존 수량과 상태를 유지한다.',
    exceptions: '원본 계획을 참조하는 변경안을 별도로 생성할 수 있다.',
    unresolved:
      '확정 취소 후 수정이 허용되는가? 변경안 승인 시 원본을 어떻게 처리하는가?',
    scenario: {
      title: '확정 계획 수량 직접 변경 거절',
      type: 'rejection',
      given: '계획 P-100은 CONFIRMED이고 수량은 100이다.',
      when: '수량을 120으로 직접 변경한다.',
      then: '요청을 거절하고 P-100의 수량 100과 CONFIRMED 상태를 유지한다.',
    },
  },
};

export const aggregateFieldExamples = [
  {
    label: '애그리게이트 루트',
    help: '외부 변경을 받아 내부 규칙을 지키는 대표 엔티티입니다.',
    example: 'Order — 항목 추가와 주문 접수를 처리한다.',
  },
  {
    label: '엔티티',
    help: '경계 안에서 식별자로 동일성을 추적하는 구성 요소입니다.',
    example: 'OrderLine — 주문 항목 ID로 구분한다.',
  },
  {
    label: '값 객체',
    help: '식별자가 아닌 값으로 구분하는 개념입니다.',
    example: 'Money(액수, 통화), ShippingAddress(배송지)',
  },
  {
    label: '항상 지켜야 할 규칙',
    help: '변경 후에도 유지해야 하는 업무 불변조건입니다.',
    example: '주문 항목 수량은 양수다. 접수된 주문에는 항목이 하나 이상이다.',
  },
  {
    label: '처리하는 명령',
    help: '루트가 처리할 행동을 같은 컨텍스트의 명령 카드에서 선택합니다.',
    example: '주문 항목 추가, 주문 접수, 주문 취소',
  },
  {
    label: '업무 규칙',
    help: '명령과 검증 사례로 구체화할 조건입니다.',
    example: '배송이 시작된 주문은 취소할 수 없다.',
  },
  ...documentationFields.aggregate.map(({ label, help, example }) => ({
    label,
    help,
    example,
  })),
  ...ruleFields.map(({ label, help, example }) => ({ label, help, example })),
  {
    label: 'Given · 초기 상태',
    help: '실행 전의 데이터와 상태를 구체적으로 적습니다.',
    example: '항목이 없는 임시 주문이다.',
  },
  {
    label: 'When · 행동',
    help: '요청할 명령과 입력을 적습니다.',
    example: '주문 접수를 요청한다.',
  },
  {
    label: 'Then · 기대 결과',
    help: '성공·거절 결과, 기존 상태와 발생할 사건을 적습니다.',
    example:
      '빈 주문 접수를 거절하고 임시 상태를 유지한다. 접수 이벤트는 발생하지 않는다.',
  },
  {
    label: '경계 밖 참조',
    help: '협력하는 다른 애그리게이트와 이유·전달 식별자를 기록합니다.',
    example:
      '환불 요청을 위해 결제를 참조한다. orderId와 paymentId를 전달한다.',
  },
  {
    label: '경계 밖 조정·실패 정책',
    help: '대기 조건·지연·중복·재시도·타임아웃·보상을 기록합니다.',
    example:
      '환불 결과를 기다리는 동안 환불 대기를 유지한다. 이벤트 ID로 중복 처리를 막고 반복 실패는 수동 확인한다.',
  },
];
