# DDD Builder Implementation Plan

**Goal:** 한국어 단계별 협업 설계 보드를 로컬 서버에서 실행한다.

**Architecture:** Node.js HTTP API와 SQLite가 데이터를 관리하고 SSE로 변경을 전달한다. React + TypeScript 화면은 같은 출처의 API에 접속한다. 실행용 서버는 Vite의 빌드 결과도 제공한다.

**Tech Stack:** Node.js 24 이상, 내장 SQLite, React, TypeScript, Vite, Lucide 아이콘, Node 테스트 러너, Playwright.

## 파일 경계

- `server/store.mjs`: 프로젝트와 카드 저장, 유효성 검사, 버전 충돌 감지, 예시 데이터.
- `server/app.mjs`: 세션 인증, HTTP API, 참여자, SSE, 정적 파일, 내보내기.
- `server/index.mjs`: 데이터 폴더, 접속 코드 생성·보관, 서버 시작, 접속 주소 안내.
- `tests/server.test.mjs`: 실제 HTTP 요청으로 인증, CRUD, 충돌, SSE, 복구 검증.
- `src/types.ts`, `src/workflow.ts`: 화면 데이터 타입과 단계별 안내.
- `src/api.ts`: 인증된 HTTP 요청 및 오류 응답.
- `src/App.tsx`: 입장, 프로젝트 전환, 변경 수신, 협업 상태.
- `src/components/*`: 단계 탐색, 보드, 카드 편집, 공유/내보내기, 프로젝트 폼.
- `src/styles.css`: 한국어 화면, 넓은 데스크톱 보드 및 모바일 레이아웃.
- `tests/e2e/*`: 두 세션 동기화와 사용자 작업 흐름 검증.
- `README.md`: 실행과 팀원 접속 방법, 저장과 백업.
- `mcp/api-client.mjs`, `mcp/server.mjs`, `mcp/index.mjs`: 인증된 HTTP 연결, MCP 도구·리소스·분석 프롬프트, stdio 실행.
- `tests/mcp.test.mjs`: 실제 MCP 클라이언트로 읽기 전용, 카드 수정 충돌과 stdio 실행 검증.

## 공유 데이터 계약

Project: `{id, name, description, revision, createdAt, updatedAt, updatedBy}`.

Card: `{id, projectId, stage, kind, title, description, contextId, data, position, revision, createdAt, updatedAt, updatedBy}`.

Stage: `discovery | events | contexts | aggregates | tasks`.

Kinds: discovery=`problem,actor,term`; events=`event,command,actor,policy,question`; contexts=`context`; aggregates=`aggregate`; tasks=`task`.

Context `data.relationships`는 관계 설명, aggregate data는 `root,entities,valueObjects,invariants`, task data는 `assignee,done`이다. 문자열 필드는 기본 빈 문자열이고 done은 boolean이다. contextId는 같은 프로젝트의 컨텍스트 카드 ID 또는 null이다.

## API 계약

- `POST /api/session` `{name,code}` → `{user:{id,name}}` 및 HttpOnly 세션 쿠키.
- `GET /api/session` → `{user:{id,name}}`; 미인증은 401.
- `DELETE /api/session` → `{ok:true}`.
- `GET /api/state` → `{projects:Project[],cards:Card[]}`.
- `GET /api/info` → `{urls:string[]}`; 인증 필요.
- `POST /api/projects` `{name,description,sample?:boolean}` → Project.
- `PATCH /api/projects/:id` `{name,description,revision}` → Project.
- `DELETE /api/projects/:id` `{revision}` → `{ok:true}`; 카드도 삭제.
- `POST /api/projects/:id/cards` 카드 입력 → Card.
- `PATCH /api/cards/:id` 수정할 카드 필드와 `{revision}` → Card.
- `DELETE /api/cards/:id` `{revision}` → `{ok:true}`.
- `GET /api/events` → SSE; event=`state`, data=`{projects,cards}` (접속 직후와 모든 저장 후); event=`presence`, data=`[{id,name}]`.
- `GET /api/projects/:id/export?format=json|markdown` → 인증 정보를 제외한 다운로드.
- 오류 응답 `{error:string,current?:Project|Card}`, 버전 충돌은 409, 입력 오류는 400, 없는 데이터는 404.

## 구현 및 확인 순서

- [x] 실제 서버 통합 테스트부터 작성하고 아직 구현되지 않은 서버에서 실패를 확인한다.
- [x] 인증, SQLite 저장, 카드 버전, SSE, 예시, 내보내기를 구현하고 `node --test tests/server.test.mjs` 통과를 확인한다.
- [x] 입장과 5단계 보드, 카드 폼, 컨텍스트 분류, 작업 완료, 순서 이동, 프로젝트 관리, 공유 및 내보내기를 구현한다.
- [x] `npm run build`로 타입 검사와 프로덕션 빌드를 확인한다.
- [x] 두 브라우저 세션으로 실시간 카드 공유, 동일 카드 충돌, 단계 이동과 다운로드를 확인한다.
- [x] API의 유효성 검사와 세션, 재연결 동작을 별도로 리뷰하고 발견된 문제를 수정한다.
- [x] 실제 실행 주소와 README를 사용자에게 제공하고 실행 중인 화면을 연다.
- [x] MCP 읽기 도구, 선택적 카드 추가·수정, 리소스, 분석 프롬프트와 연결 설정 복사를 구현하고 실제 stdio 클라이언트로 검증한다.
