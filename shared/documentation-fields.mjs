// These descriptions are shared by the editor, generated documents and MCP schema.
export const documentationFields = {
  term: [
    {
      key: 'codeName',
      label: '코드명',
      help: '업무 용어에 대응하는 코드 이름을 적으세요.',
      example: 'ProductionPlan',
    },
    {
      key: 'distinction',
      label: '구별 사례',
      help: '이 개념에 해당하는 사례와 다른 개념인 사례를 구분하세요.',
      example:
        '생산계획은 예정 수량이다. 작업지시는 현장에 실행을 요청한 작업이다.',
    },
    {
      key: 'confusedWith',
      label: '혼동하면 안 되는 용어',
      help: '동의어로 취급하면 의미가 달라지는 용어를 적으세요.',
      example: '작업지시, 수요예측과 구분한다.',
    },
    {
      key: 'source',
      label: '정의의 출처',
      help: '원본 문서 위치나 확인한 담당자·사례를 기록하세요.',
      example: '생산계획 운영 지침 3절 · 계획 담당자 검토',
    },
    {
      key: 'unresolved',
      label: '미결정 사항',
      help: '확인하지 못한 의미나 정책은 질문으로 남기세요.',
      example: '확정 취소된 계획도 생산계획에 포함하는가?',
    },
  ],
  context: [
    {
      key: 'purpose',
      label: '컨텍스트 목적',
      help: '이 경계가 해결하는 업무 문제를 적으세요.',
      example: '수요와 생산 능력을 반영해 실행 가능한 생산계획을 수립한다.',
    },
    {
      key: 'outOfScope',
      label: '책임 밖의 일',
      help: '다른 경계가 담당하는 일을 명시하세요.',
      example: '현장 작업 실행과 실적 집계는 생산 실행 컨텍스트가 담당한다.',
    },
    {
      key: 'ownership',
      label: '소유 데이터·규칙',
      help: '이 컨텍스트가 변경과 의미를 책임지는 정보를 적으세요.',
      example: '계획 수량, 계획 상태, 확정 조건을 소유한다.',
    },
    {
      key: 'dependencies',
      label: '외부 의존성',
      help: '필요한 외부 정보와 그 정보의 소유자를 적으세요.',
      example: '수요관리에서 수요예측을, 설비관리에서 가용 능력을 제공받는다.',
    },
    {
      key: 'integrationContract',
      label: '연동 계약',
      help: '상대·방향·소유자·용어 변환·API/이벤트·실패 처리·버전 정책을 적으세요.',
      example:
        '계획 → 생산 실행: 계획확정됨 v1 전달. 계획 ID와 수량을 포함하고 이벤트 ID로 중복을 제거한다. 필드 제거는 새 버전에서 협의한다.',
    },
    {
      key: 'unresolved',
      label: '미결정 사항',
      help: '경계나 연동에서 아직 결정하지 않은 질문을 남기세요.',
      example: '생산 실행이 확정 이벤트를 받지 못하면 언제 재전송하는가?',
    },
  ],
  aggregate: [
    {
      key: 'stateTransitions',
      label: '상태 전이',
      help: '현재 상태·명령·다음 상태와 거절 조건을 적으세요.',
      example:
        'DRAFT → 계획 확정 → CONFIRMED. CONFIRMED에서 수량 직접 변경은 거절한다.',
    },
    {
      key: 'transactionBoundary',
      label: '트랜잭션 경계',
      help: '한 번의 변경에서 함께 저장하고 검증할 범위를 적으세요.',
      example:
        'ProductionPlan과 PlanLine의 수량·상태를 함께 변경한다. 다른 계획과 작업지시는 별도 트랜잭션이다.',
    },
    {
      key: 'unresolved',
      label: '미결정 사항',
      help: '상태 전이나 일관성 전략에서 확인할 질문을 남기세요.',
      example: '확정 취소 후 수정이 허용되는가?',
    },
  ],
  task: [
    {
      key: 'acceptanceCriteria',
      label: '완료 확인 기준',
      help: '업무 규칙과 관찰 가능한 결과를 기준으로 적으세요.',
      example: 'PLAN-001 거절 사례에서 계획 수량과 상태가 유지된다.',
    },
    {
      key: 'testReferences',
      label: '관련 테스트 위치',
      help: '실제 존재하는 테스트의 경로·이름을 기록하세요. 실행 결과는 별도로 확인해야 합니다.',
      example: 'tests/domain/production-plan.test.ts · 확정 계획 수정 거절',
    },
  ],
};
export const ruleFields = [
  {
    key: 'scope',
    label: '적용 대상·범위',
    help: '규칙이 적용되는 객체와 변경 범위를 적으세요.',
    example: 'ProductionPlan의 계획 수량 직접 변경',
  },
  {
    key: 'condition',
    label: '적용 조건',
    help: '어떤 상태나 조건에서 이 규칙을 검사하나요?',
    example: '계획 상태가 CONFIRMED이다.',
  },
  {
    key: 'violation',
    label: '위반 결과',
    help: '거절 결과와 기존 상태·이벤트에 미치는 영향을 적으세요.',
    example:
      '요청을 거절하고 기존 수량과 상태를 유지한다. 변경 이벤트를 발생시키지 않는다.',
  },
  {
    key: 'exceptions',
    label: '예외·허용 대안',
    help: '명시적으로 허용한 예외나 대안을 적으세요.',
    example: '원본 계획을 참조하는 변경안을 별도로 생성할 수 있다.',
  },
  {
    key: 'unresolved',
    label: '미결정 사항',
    help: '결정하지 않은 정책을 질문으로 남기세요.',
    example: '변경안 승인 시 원본 계획을 어떻게 처리하는가?',
  },
  {
    key: 'source',
    label: '규칙의 출처·검토 근거',
    help: '원본 문서와 업무 담당자의 검토 내용을 적으세요.',
    example: '생산계획 운영 지침 PLAN-001 · 담당자 검토 대기',
  },
];
export const documentationKeys = Object.fromEntries(
  Object.entries(documentationFields).map(([kind, fields]) => [
    kind,
    fields.map((f) => f.key),
  ]),
);
