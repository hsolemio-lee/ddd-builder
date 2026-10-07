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
