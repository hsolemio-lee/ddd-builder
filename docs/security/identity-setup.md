# 개인 인증 전환 준비

## 현재 배포 확인 (2026-10-07)

전용 Google Cloud 프로젝트 `hsolemio-ddd-builder-20261007`에 `DDD Builder` 웹 OAuth 클라이언트를 등록하고, 아래의 정확한 리디렉션 URI와 `openid email profile` 범위로 연결했다. 비밀값은 Git 제외 로컬 `.env`에 파일 권한 600으로 보관한다. Google 앱은 테스트 상태이며, 공개 배포와 동의 화면의 정책·도메인 검토는 별도로 완료해야 한다.

별도 복제 볼륨에서 실제 Google 관리자 로그인과 기존 프로젝트 2개·카드 14개의 전체 내용 일치를 확인한 뒤, 운영 서버를 `SERVICE_MODE=production`, `AUTH_MODE=oidc`로 전환했다. 운영 서버의 실제 로그인, 최초 관리자의 기존 프로젝트 권한, `auth.login` 성공 감사 기록도 확인했다. 공유 코드 로그인은 405, 비로그인 상태 조회는 401을 반환한다. 공개 HTTPS 로그인 경로에서 PKCE S256, 정확한 callback, Secure·HttpOnly 바인딩 쿠키와 HSTS를 확인했다.

공개 연결은 Funnel HTTPS 443 → 호스트 루프백 3210 → 컨테이너 3210이다. 복제 검증에만 사용한 루프백 3211 서버는 검증 후 제거한다. MCP는 프로젝트 토큰을 사용하는 stdio 클라이언트와 같은 HTTPS 서비스의 `/mcp` Streamable HTTP 엔드포인트를 지원한다. 별도의 공개 MCP 포트는 없다. HTTP 연결은 매 요청에서 Bearer 토큰을 검증하고 브라우저 쿠키는 받지 않는다. MCP OAuth 자동 로그인은 제공하지 않는다.

실제 인증 연결 완료가 공식 출시 조건 전체 충족을 뜻하지 않는다. 관리자 MFA·두 번째 운영 담당자·복구 절차, 외부 암호화 백업과 경보 수신, 공개 개인정보 안내·문의 경로는 아직 검증되지 않았다. [출시 판정](controls.md)을 따른다.

공식 서비스의 기본 정책은 초대받은 사용자만 가입하는 것이다. 기존 공유 코드는 개발 모드에서만 유지한다. 구현 및 테스트를 마치더라도 실제 인증 공급자 설정과 관리자 로그인 검증 전에는 운영 서버를 전환하지 않는다.

## OIDC 공급자 등록

운영자가 관리하는 Google 또는 OIDC 공급자에 웹 애플리케이션을 등록한다. 공급자는 서명된 ID 토큰에서 `sub`, `email`, `email_verified=true`를 제공해야 한다. 이메일 검증 여부를 보장하지 않는 공급자를 임의로 허용하지 않는다.

- 공개 서비스 주소: `https://sol-macmini-2.tail6d02c8.ts.net`
- 등록할 리디렉션 URI: `https://sol-macmini-2.tail6d02c8.ts.net/api/auth/callback`
- 요청 범위: `openid email profile`
- 관리자: 운영자가 소유하고 이메일 검증과 MFA를 완료한 계정
- 테스트 공급자는 운영과 다른 client ID와 비밀키 사용

client secret은 채팅이나 Git에 올리지 않는다. 로컬의 Git 제외 환경 파일 또는 배포 플랫폼의 비밀 저장소에 입력한다. 운영 환경 변수는 `SERVICE_MODE=production`, `AUTH_MODE=oidc`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OWNER_EMAIL`, `PUBLIC_URL`이다. `.env.example`를 복사한 `.env`에 입력하고 파일 권한을 `chmod 600 .env`로 제한한다.

Google을 사용하는 경우 [Google 공식 OIDC 문서](https://developers.google.com/identity/openid-connect/openid-connect)를 따라 Cloud Console에서 Web application OAuth 클라이언트를 생성한다. issuer는 `https://accounts.google.com`이다. 승인된 redirect URI를 위 주소와 정확하게 일치시킨다. 공급자 측 앱 공개 범위와 동의 화면도 실제 이용 대상에 맞춰 설정한다.

전환 준비를 마친 뒤 `docker compose up -d --build --wait`로 적용한다. 별도 복제 볼륨에서 먼저 실제 관리자 로그인을 확인한다. 운영 볼륨에는 확인되지 않은 테스트 공급자를 연결하지 않는다.

최초 관리자 등록은 검증된 이메일을 기준으로 최초 1회만 허용하고 이후에는 공급자 issuer와 subject에 묶는다. 계정의 이메일이 같아도 다른 issuer 또는 subject를 기존 관리자와 자동으로 연결하지 않는다. 기존 프로젝트의 소유권 이전은 이 등록 시 한 번만 수행하며 카드는 보존한다.

## 전환 전 확인

1. 운영 데이터를 별도 볼륨으로 복제하고 격리된 포트에서 시작한다.
2. 관리자만 기존 프로젝트를 조회할 수 있는지 확인한다.
3. 조회자와 편집자를 초대하고 REST, SSE, 내보내기, MCP 권한을 검증한다.
4. 초대 취소·계정 비활성화·토큰 철회가 기존 연결에도 적용되는지 확인한다.
5. 실제 공급자로 관리자 로그인에 성공한 뒤 운영의 인증 모드를 바꾼다.
6. 환경 설정이 누락되면 운영 모드는 시작을 거부한다. 공유 코드로 자동 대체하지 않는다.
