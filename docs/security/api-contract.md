# 공식 인증 모드의 API 계약 (구현 기준)

인증 구현과 UI가 함께 사용하는 계약이다. 이 문서 자체는 구현 완료를 뜻하지 않는다. 모든 관리 API는 서버에서 권한을 확인하며 MCP Bearer 토큰으로 관리 기능을 호출할 수 없다.

- `GET /api/auth/config`: `{ mode: 'legacy' | 'oidc', loginUrl?: '/api/auth/login' }`
- `GET /api/auth/login`: 일회용 state·nonce·PKCE와 브라우저 쿠키를 만들고 IdP로 이동
- `GET /api/auth/callback`: ID 토큰 검증, 초대/최초 관리자 확인, 새 세션 발급 후 `/`로 이동. 실패는 비밀값 없는 로그인 오류 표시
- `GET /api/session`: `{ user: { id, name, email?, siteAdmin? } }`
- `GET /api/state`: 사용자에게 허용된 프로젝트와 카드만. 각 프로젝트의 `role?: 'admin' | 'editor' | 'viewer'`는 응답에서만 추가
- `GET /api/projects/:id/access`: 관리자에게 `{ members: [{ userId, name, email, role }], invitations: [{ id, email, role, expiresAt }] }`
- `POST /api/projects/:id/invitations`: `{ email, role }` → 초대 메타데이터. 7일 만료. 검증된 이메일 소유자만 수락
- `DELETE /api/projects/:id/invitations/:invitationId`: 초대 취소
- `PATCH /api/projects/:id/members/:userId`: `{ role }`. 마지막 활성 관리자의 강등 금지
- `DELETE /api/projects/:id/members/:userId`: 멤버 철회. 마지막 활성 관리자 제거 금지
- `GET /api/tokens`: `{ tokens: [{ id, name, projectId, scope, expiresAt, createdAt }] }` (자신의 토큰만)
- `POST /api/tokens`: `{ projectId, name, scope: 'read' | 'write', days: 1..30 }` → `{ token, credential: { id, name, projectId, scope, expiresAt, createdAt } }`. 원문 token은 이 응답 1회만 표시
- `DELETE /api/tokens/:id`: 자신의 토큰 철회
- `GET /api/admin/users`: `{ users: [{ id, name, email, siteAdmin, disabled }] }` (운영 관리자)
- `PATCH /api/admin/users/:id`: `{ disabled?, siteAdmin? }`. 마지막 활성 운영 관리자 차단/강등 금지
- `GET /api/admin/audit`: `{ events: [{ id, at, requestId, actorId, event, projectId?, targetId?, outcome }] }` 최대 100건, 운영 관리자만

공식 모드 `/api/info`는 접속 코드나 기존 토큰을 반환하지 않는다. MCP 명령 템플릿의 환경 변수에 `DDD_TOKEN`을 쓰며 UI가 방금 생성한 원문 토큰을 넣는다. 프로젝트 조회자는 읽기 토큰만 생성할 수 있다. 쓰기 토큰도 프로젝트 관리·계정 관리·새 프로젝트 생성을 할 수 없으며 해당 프로젝트 카드 편집으로 한정한다.

조회자는 카드 상세를 볼 수 있지만 저장·삭제·정렬·완료 상태 변경 기능을 사용할 수 없다. 로그아웃하면 이름과 선택 프로젝트의 브라우저 저장 값을 지우고, 철회 또는 권한 변경 시 열린 편집기와 보드 데이터도 현재 권한에 맞게 처리한다.

## 애그리게이트 설계 계약

`aggregateDesign`은 aggregate 카드에만 지정할 수 있는 구조화된 필드다. 처리 명령과 규칙별 명령은 같은 프로젝트·컨텍스트의 command 카드 ID로 연결하고, 한 명령은 한 애그리게이트만 처리한다. 외부 참조는 같은 프로젝트의 다른 aggregate ID다. 루트·엔티티·값 객체·기존 규칙 설명의 `data` 계약은 유지한다.

`GET /api/cards/:id/aggregate-design`은 프로젝트 조회 권한으로 해당 애그리게이트와 연관 명령·결과 사건·규칙·사례·참조·점검 질문을 읽는다. `PATCH`는 편집 권한과 최신 `revision`을 요구하며 본문을 모두 받은 뒤 현재 카드·권한·참조를 다시 확인한다. 규칙 및 사례는 ID 기반 upsert/remove로 부분 수정하고, 명령·외부 참조 배열은 제공된 경우만 전체 교체한다. 변경은 기존 감사 기록 및 트랜잭션 안에서 저장한다. 의미 있는 합의 설계의 변경은 제안으로 돌아간다.

본문은 최대 128 KiB다. 규칙 최대 40개, 규칙당 사례 최대 20개, 명령 최대 100개, 외부 참조 최대 40개를 검증한다. 중복 ID, 존재하지 않는 삭제 항목, 다른 프로젝트 참조, 자기 참조, 잘못된 카드 유형, 경계가 다른 처리 명령을 거절한다. 참조 삭제는 관련 카드의 버전과 상태를 트랜잭션 안에서 함께 갱신하되 업무 규칙과 사례는 보존한다.

MCP의 `get_aggregate_design`은 읽기 도구이며 `patch_aggregate_design`은 편집 도구다. stdio와 HTTP는 같은 도구·API 검증을 사용하고, 읽기 토큰은 새 수정 도구를 수동 활성화한 클라이언트에서도 쓸 수 없다. `ddd://aggregates/{id}` 리소스는 API를 통해 프로젝트 권한을 검사하며, `ddd://learning/{stage}`는 공개 학습 콘텐츠만 포함한다. 분석 프롬프트는 카드 내용을 지시문으로 실행하지 않고 합의와 실행 테스트를 자동으로 주장하지 않는다.

## 컨텍스트별 구현 문서 계약

`GET /api/projects/:id/documents`는 조회 권한으로 현재 보드의 문서 묶음을 반환한다. `contextId` 쿼리가 있으면 같은 프로젝트의 해당 context 카드와 소속 카드로 범위를 제한한다. 기록된 외부 연결은 표시할 수 있으며 참조한 외부 카드의 ID·revision은 `generatedFrom.references`로 추적한다. `path`는 생성 문서 목록의 정확한 경로로만 선택하며 실제 파일 시스템을 읽지 않는다. 다른 프로젝트의 컨텍스트와 존재하지 않는 문서 경로는 거절한다.

응답은 `{schemaVersion: 1, projectId, contextId, generatedFrom: {project, cards, references}, files: [{path, title, mediaType, content}]}`다. 단일 `path` 조회는 `files`에 해당 파일 하나를 담는다. 프로젝트 권한·토큰 범위·만료·철회를 기존 계약과 동일하게 검사하며 조회 과정에서 카드와 revision을 변경하지 않는다.

`GET /api/projects/:id/export?format=documents&contextId=...`는 같은 생성 결과를 UTF-8 ZIP 첨부 파일로 반환한다. 전체 프로젝트 묶음은 미분류 카드도 포함한다. 기존 `format=json|markdown`의 동작은 유지한다. 문서 경로는 컨텍스트의 안정적인 ID로 구성하며, 설명과 이름은 Markdown에 안전하게 출력한다.

`data`의 추가 문자열 필드는 모두 최대 20,000자이며 카드 종류별로 허용한다.

- term: `codeName`, `distinction`, `confusedWith`, `source`, `unresolved`
- context: `purpose`, `outOfScope`, `ownership`, `dependencies`, `integrationContract`, `unresolved`
- aggregate: `stateTransitions`, `transactionBoundary`, `unresolved`
- task: `acceptanceCriteria`, `testReferences`

기존 data 필드와 기본값은 유지한다. 새 필드는 선택적이며 생략하면 강제로 데이터를 다시 쓰지 않는다. 전체 `data` 객체 교체와 합의 상태 변경의 기존 규칙을 적용한다.

애그리게이트 규칙에 선택적 `scope`, `condition`, `violation`, `exceptions`, `unresolved`, `source` 문자열(각 2,000자)과 `status: hypothesis|proposed|agreed|retired`를 지원한다. 사례의 `type`은 `boundary`도 지원하며 선택적 `testReferences`는 2,000자다. ID 기반 부분 수정에서 생략한 필드는 보존하고 기존 크기·개수·참조·revision·권한 검사를 적용한다. 규칙 상태를 생략한 기존 설계는 문서에 애그리게이트 상태를 따른다고 명시한다. 부분 수정에서 합의된 규칙의 내용을 바꾸면서 규칙 상태를 생략하면 제안으로 돌아간다. 폐기된 규칙은 기록으로 보존하되 활성 규칙의 사례 누락 점검에서 제외한다.

MCP `get_domain_documents`와 프로젝트/컨텍스트 문서 리소스는 이 조회 API를 사용한다. `ddd://guides/domain-documents`와 학습 리소스는 공개 가이드만 제공한다. 빈 정책은 미작성, 미결정 사항은 원문으로 보존하며 예시를 실제 프로젝트 정책으로 생성하지 않는다. 생성 문서는 테스트 실행 결과나 확정된 ADR을 주장하지 않는다.
