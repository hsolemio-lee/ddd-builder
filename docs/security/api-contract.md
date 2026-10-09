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
