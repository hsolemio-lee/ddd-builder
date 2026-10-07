# DDD Builder

로컬 컴퓨터에서 실행하는 한국어 DDD 협업 워크숍입니다. 같은 네트워크의 팀원이 브라우저로 참여하고, 외부 AI는 MCP로 보드를 읽고 정리할 수 있습니다.

## Docker Compose로 바로 실행하기

Docker Desktop 또는 Docker Engine과 Compose가 실행 중이면, 호스트에 Node나 SQLite를 설치하지 않고 시작할 수 있습니다.

```sh
docker compose up -d --build --wait
docker exec ddd-builder cat /app/data/access-code
```

`http://localhost:3210`을 열고 두 번째 명령으로 읽은 접속 코드를 입력합니다. 서버 로그에는 접속 코드를 기록하지 않습니다. 컨테이너 이름을 변경했다면 `docker exec`의 `ddd-builder`도 해당 이름으로 바꿉니다. 첫 명령이 화면 빌드와 서버 실행을 모두 처리합니다. 프로젝트와 접속 코드는 `workshop-data` 이름의 Docker 볼륨에 저장되어 재시작·업데이트 뒤에도 유지됩니다.

```sh
# 상태와 로그
docker compose ps
docker compose logs -f ddd-builder

# 종료 (저장 볼륨 유지)
docker compose down

# 다시 실행 또는 코드 업데이트 적용
docker compose up -d --build --wait
```

`docker compose down -v`는 저장 볼륨도 삭제합니다. 기존 `npm start` 서버가 3210 포트를 쓰고 있다면 종료하거나 아래 방법으로 Compose 포트를 바꿉니다.

### 포트와 팀원 접속 주소

기본 설정으로 바로 실행할 수 있으며, 변경이 필요할 때만 `.env.example`을 `.env`로 복사합니다.

```sh
cp .env.example .env
```

예를 들어 `.env`에 다음과 같이 설정하면 호스트의 3300 포트에서 접속을 받고, 앱의 **초대하기**에 호스트의 LAN 주소를 표시합니다. 주소는 실제 호스트 컴퓨터의 IP로 바꿔 주세요.

```dotenv
DDD_PORT=3300
DDD_BIND_ADDRESS=0.0.0.0
PUBLIC_URL=http://192.168.0.108:3300
```

설정 변경 후 `docker compose up -d --wait`를 실행합니다. 기본 호스트 바인딩은 `127.0.0.1`이며, LAN 공유는 위처럼 `DDD_BIND_ADDRESS=0.0.0.0`을 지정해 켭니다. Docker 안에서 보이는 내부 IP는 팀원 접속 주소로 표시하지 않습니다. `PUBLIC_URL`을 지정하지 않으면 `localhost` 주소가 표시되므로, 팀원에게는 호스트 컴퓨터의 LAN IP와 공개 포트를 전달하세요.

### Docker 실행에서 MCP 연결

앱의 **AI와 함께 설계하기 → MCP 설정 복사**를 사용합니다. Docker 실행에서는 호스트의 AI 클라이언트가 `docker exec -i`로 컨테이너 내부의 MCP에 연결하므로, 호스트에 Node를 설치할 필요가 없습니다. Docker가 실행 중이어야 하고, AI 클라이언트에서 `docker` 명령을 찾을 수 있어야 합니다. 찾지 못하면 설정의 `command`를 호스트의 Docker 실행 파일 절대 경로로 바꾸세요.

Node 실행 방식에서 복사했던 MCP 설정은 새 설정으로 교체합니다. **AI가 보드를 수정하도록 허용** 선택도 Docker MCP 프로세스에 전달되며, 기본값은 읽기 전용입니다. 이 Docker 설정은 Docker가 실행 중인 호스트의 AI 클라이언트용입니다.

### 기존 로컬 데이터 가져오기

직접 실행의 `data/` 폴더와 Docker 볼륨은 별도 저장소입니다. 기존 데이터를 가져올 때는 기존 `npm start` 서버와 Compose 앱을 먼저 종료하고, 대상 Docker 볼륨이 비어 있는 상태에서 아래 명령을 실행합니다. 기존 볼륨에 이미 작업이 있다면 먼저 백업하고 다른 저장소로 보관하세요.

```sh
docker compose stop
docker compose run --rm --no-deps --user root --entrypoint sh \
  -v "$PWD/data:/source:ro" ddd-builder \
  -c 'cp -a /source/. /app/data/ && chown -R node:node /app/data'
docker compose up -d --wait
```

호스트의 원본 파일은 읽기 전용으로 사용하며 수정하지 않습니다. 원본 접속 코드도 함께 가져와 같은 코드로 입장할 수 있습니다.

### Docker 데이터 백업과 복원

앱을 잠시 정지한 상태에서 전체 볼륨을 백업합니다.

```sh
docker compose stop
mkdir -p backups
docker compose run --rm --no-deps --user root --entrypoint tar \
  ddd-builder -czf - -C /app/data . > backups/ddd-builder-data.tar.gz
docker compose start
```

복원할 때는 서버를 정지하고, 저장된 백업을 대상 볼륨에 풀어 줍니다. 아래 명령은 현재 데이터베이스를 백업 내용으로 교체합니다.

```sh
docker compose stop
docker compose run --rm -T --no-deps --user root --entrypoint sh \
  ddd-builder -c 'rm -f /app/data/ddd-builder.sqlite /app/data/ddd-builder.sqlite-wal /app/data/ddd-builder.sqlite-shm; tar -xzf - -C /app/data && chown -R node:node /app/data' \
  < backups/ddd-builder-data.tar.gz
docker compose up -d --wait
```

컨테이너는 일반 사용자로 실행하고, 앱 코드가 있는 파일 시스템은 읽기 전용입니다. 메모리 512 MiB, CPU 1개, 프로세스 128개로 제한하며 Docker Desktop에서도 적용됩니다. 위의 백업·복원 명령은 `--user root`로 저장 볼륨만 관리합니다. 앱 데이터는 저장 볼륨에 기록합니다. 기본 명명 규칙에서 볼륨 이름은 `ddd-builder_workshop-data`입니다. Compose 프로젝트 이름을 바꾸면 저장 볼륨도 해당 프로젝트 이름을 따릅니다.

Compose의 환경 변수 설정 참고: [Docker 공식 문서](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/).

## Tailscale Funnel로 외부에 공유하기

호스트에 Tailscale을 설치하고 로그인한 뒤, Docker 앱을 실행한 상태에서 아래 명령으로 공개 HTTPS 주소를 만듭니다. 공유기 포트포워딩은 필요하지 않습니다.

```sh
docker compose up -d --build --wait
tailscale funnel --bg --https=443 http://127.0.0.1:3210
```

첫 실행에서 Funnel 활성화 승인 링크가 표시되면 브라우저에서 승인합니다. 출력된 `https://기기이름.네트워크이름.ts.net` 주소를 `.env`의 `PUBLIC_URL`로 지정하고 앱을 다시 실행합니다. 이 주소를 설정해야 외부 브라우저의 HTTPS 로그인과 초대 링크가 올바르게 동작합니다.

```dotenv
PUBLIC_URL=https://기기이름.네트워크이름.ts.net
```

```sh
docker compose up -d --build --wait
tailscale funnel status

# 외부 공유 종료 (로컬 앱과 저장 데이터는 유지)
tailscale funnel --https=443 off
```

외부 사용자는 HTTPS의 기본 포트인 **443**으로 접속하고, Funnel이 호스트의 **3210** 포트로 전달합니다. 접속자는 Tailscale을 설치하지 않고 앱의 기존 접속 코드로 입장합니다. 호스트 컴퓨터, Docker 앱, Tailscale은 실행 중이어야 하며, `--bg` 설정은 터미널 종료 뒤에도 유지됩니다.

공개 DNS 반영에는 최대 10분이 걸릴 수 있습니다. 사내 접속을 비교하려면 먼저 휴대폰 모바일 데이터에서 같은 주소를 확인하세요. 호스트 자체의 Tailscale 연결을 통한 접속 성공만으로 공개 인터넷 접속을 확인할 수는 없습니다.

MCP는 **stdio 방식이므로 별도의 공개 포트가 없습니다**. 호스트에서는 앱의 Docker MCP 설정을 그대로 사용합니다. 다른 컴퓨터의 AI 클라이언트에는 저장소와 Node 24 이상을 준비하고 `npm ci`를 실행한 뒤, 해당 컴퓨터의 `mcp/index.mjs`를 실행하도록 설정합니다. `DDD_URL`은 Funnel의 HTTPS 주소, `DDD_CODE`는 기존 앱 접속 코드입니다. MCP 프로세스가 공개 HTTPS 주소의 **443** 포트로 앱 API에 연결합니다. 클라우드 AI용 HTTP MCP 엔드포인트는 제공하지 않습니다.

공식 안내: [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel).

## Node로 직접 실행하기

Node.js **24 이상**이 필요합니다. SQLite는 Node에 내장된 모듈을 사용하므로 별도 데이터베이스 설치가 필요하지 않습니다.

```sh
npm ci
npm run build
npm start
```

브라우저에서 `http://localhost:3210`을 엽니다. 다른 터미널에서 `cat data/access-code`로 코드를 읽고 이름과 함께 입력합니다. `DATA_DIR`을 변경했다면 해당 폴더의 `access-code` 파일을 읽습니다. 서버 로그에는 파일 경로만 표시합니다. 처음 실행하면 수정 가능한 **온라인 주문 서비스** 예시 프로젝트가 만들어집니다.

종료는 터미널에서 `Ctrl+C`를 누릅니다. 다음에 `npm start`로 다시 실행하면 저장된 설계가 복구됩니다. 참여자는 다시 입장해야 합니다.

## 팀원과 함께 사용하기

1. 호스트 컴퓨터에서 `docker compose up -d --build --wait` 또는 `npm start`를 실행합니다.
2. 앱의 **초대하기**에서 `http://192.168.…:3210` 같은 로컬 네트워크 주소와 접속 코드를 팀원에게 전달합니다. `localhost`와 `127.0.0.1`은 호스트 컴퓨터에서 사용하는 주소입니다.
3. 팀원이 같은 네트워크에서 브라우저로 접속하고, 자신의 이름과 코드를 입력합니다.

서버는 기본적으로 `127.0.0.1:3210`에서 접속을 받습니다. 같은 네트워크에 공유하려면 Compose는 `DDD_BIND_ADDRESS=0.0.0.0`, Node 직접 실행은 `HOST=0.0.0.0 npm start`를 사용합니다. 호스트 컴퓨터가 켜져 있고 서버가 실행 중이어야 하며, 방화벽에서 해당 포트의 접속을 허용해야 합니다. 게스트 Wi-Fi의 기기 간 통신 차단이 있으면 접속할 수 없습니다.

같은 카드의 이전 버전을 저장하면 이미 저장된 내용을 덮어쓰지 않고 충돌을 표시합니다. 편집 중인 내용은 유지되며, 필요한 내용을 복사한 뒤 최신 내용을 불러올 수 있습니다. 연결이 끊겼다가 복구되면 전체 보드를 다시 받습니다.

공유 코드를 아는 참여자는 같은 작업 공간의 프로젝트를 읽고 수정할 수 있습니다. 이름은 표시용이며, 역할별 권한은 없습니다. 직접 실행의 서버는 HTTP를 사용합니다. 외부 공유는 위의 Tailscale Funnel HTTPS 구성을 사용하며, 지정한 `PUBLIC_URL`의 요청을 허용하고 HTTPS 접속의 세션 쿠키에 `Secure`를 적용합니다. 계정별 로그인과 역할별 권한은 포함하지 않습니다.

응답에는 CSP, 프레임 차단, `nosniff`, 권한 제한 헤더를 적용합니다. CSP는 같은 출처의 스크립트와 연결만 허용하며, 화면의 React 스타일을 위해 인라인 CSS를 허용합니다. HSTS는 명시한 HTTPS `PUBLIC_URL`의 호스트 요청에만 적용하며 로컬 HTTP에는 적용하지 않습니다. HTTPS 종료 프록시는 공개 호스트를 `Host`에 보존해야 합니다. 공개 HTTPS 호스트에 HTTP 출처를 붙인 변경 요청은 거부합니다.

고정 1분 창마다 API 요청은 소켓 IP당 1,200회, 코드 로그인 시도는 소켓 IP당 30회, 인증된 변경 요청은 세션당 300회로 제한합니다. 초과 요청은 `429`와 `Retry-After`를 반환합니다. 인증된 참여자의 허용된 출처 로그아웃은 API·변경 한도를 초과해도 세션과 SSE 연결을 종료할 수 있습니다. `X-Forwarded-For` 등 전달 헤더를 신뢰하지 않으므로 NAT 또는 Funnel 뒤의 참여자는 프록시 IP의 한도를 공유합니다. 각 한도 저장소는 최대 4,096개 키를 보관하고 만료된 키를 정리하며, 가득 차면 기존 카운터를 지우지 않고 새 키를 거부합니다. 활성 세션은 최대 200개로 12시간 유지하고, 실시간 SSE 연결은 전체 200개·세션당 5개로 제한합니다. 초과 연결은 기존 연결을 끊지 않으며 로그아웃·만료·연결 종료 시 자원을 반환합니다. 테스트나 별도 서버 통합에서는 `createApp({ security: { ... } })`로 양의 정수 한도를 지정할 수 있고, 잘못된 설정은 데이터베이스를 열기 전에 거부합니다.

## 설계 흐름

| 단계              | 정리할 내용                                    |
| ----------------- | ---------------------------------------------- |
| 도메인 탐색       | 문제, 행위자, 공통 용어                        |
| 이벤트 정리       | 도메인 이벤트, 명령, 행위자, 정책, 미해결 질문 |
| 컨텍스트 나누기   | 각 영역의 책임·관계, 이벤트의 컨텍스트 분류    |
| 애그리게이트 설계 | 루트, 엔티티, 값 객체, 항상 지켜야 할 규칙     |
| 구현 체크리스트   | 작업, 담당자, 완료 상태                        |

단계는 자유롭게 오갈 수 있습니다. 카드를 클릭해 편집하고, 카드의 위·아래 화살표로 같은 유형 안에서 순서를 바꿉니다. **결과 내보내기**에서 모든 단계의 Markdown 문서 또는 JSON 데이터를 다운로드합니다.

## 외부 AI와 MCP로 협업하기

MCP 서버는 **stdio 전송**을 사용합니다. 앱이 AI 모델을 실행하거나 API 키를 관리하지는 않습니다. 연결한 AI 클라이언트의 모델이 보드를 분석합니다.

1. DDD Builder 앱 서버를 실행해 둡니다.
2. 앱 왼쪽의 **AI와 함께 설계하기**를 엽니다.
3. **MCP 설정 복사**를 눌러 로컬 AI 클라이언트의 MCP 서버 설정에 추가합니다. 실행 방식에 맞는 Docker 또는 Node 명령과 앱 주소, 접속 코드가 포함됩니다.
4. 클라이언트가 JSON 설정을 사용하지 않으면 표시된 `command`, `args`, `env`를 해당 클라이언트의 MCP 설정 형식으로 옮깁니다.
5. 클라이언트에서 프로젝트 목록을 읽고 분석을 요청합니다. 앱에서 **분석 요청 복사**를 누르면 프로젝트 ID가 포함된 요청문을 얻습니다.

설정 형식 예시입니다. 실제 값은 앱에서 복사해 사용하세요.

```json
{
  "mcpServers": {
    "ddd-builder": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/ddd-builder/mcp/index.mjs"],
      "env": {
        "DDD_URL": "http://127.0.0.1:3210",
        "DDD_CODE": "호스트의 접속 코드",
        "DDD_READ_ONLY": "true"
      }
    }
  }
}
```

처음에는 읽기 전용입니다. **AI가 보드를 수정하도록 허용**을 선택하고 설정을 다시 복사하면 카드 추가·수정 도구가 활성화됩니다. AI가 저장한 내용은 `AI 도우미` 이름으로 표시되고 참여자에게 실시간 공유됩니다. 기존 카드 수정에는 현재 `revision`이 필요하며, 사람과 동일한 충돌 검사를 적용합니다.

| MCP 기능                     | 용도                                               |
| ---------------------------- | -------------------------------------------------- |
| `list_projects`              | 프로젝트 목록과 ID 조회                            |
| `get_project_board`          | 프로젝트 및 단계별 카드, 컨텍스트 조회             |
| `create_card`                | 새 카드 추가 · 수정 허용 시 활성화                 |
| `update_card`                | 현재 버전을 확인한 카드 수정 · 수정 허용 시 활성화 |
| `ddd://projects`             | 프로젝트 목록 리소스                               |
| `ddd://projects/{projectId}` | 프로젝트의 전체 보드 리소스                        |
| `analyze_event_storming`     | 중복·누락·경계·규칙을 검토하는 분석 프롬프트       |

예: “주문 서비스의 이벤트 스토밍 결과를 읽고, 중복 이벤트와 빠진 명령·정책을 찾아 줘. 바운디드 컨텍스트 경계와 애그리게이트를 제안해 줘. 먼저 제안을 보여 준 다음, 내가 요청하면 보드를 수정해 줘.”

다른 컴퓨터의 로컬 AI 클라이언트에서도 연결할 수 있습니다. 그 컴퓨터에 이 프로젝트와 Node를 준비하고 `npm ci`를 실행한 다음, MCP 설정의 실행 경로를 해당 컴퓨터의 경로로 바꾸고 `DDD_URL`을 호스트의 로컬 네트워크 주소로 변경합니다. `DDD_CODE`는 같은 접속 코드를 사용합니다. 클라우드 AI가 직접 접속할 공개 HTTP MCP 엔드포인트는 제공하지 않습니다.

MCP 공식 개념과 연결 방식: [MCP 서버 개발 가이드](https://modelcontextprotocol.io/docs/develop/build-server).

## 저장과 백업

- 기본 저장 위치: 프로젝트의 `data/ddd-builder.sqlite`.
- 접속 코드: `data/access-code`. 서버 재시작 후에도 유지됩니다.
- 프로젝트별 데이터 보관: 앱의 **결과 내보내기 → JSON 백업**. 현재 앱에는 JSON 가져오기 기능이 없습니다.
- 완전한 백업과 복원: 서버를 종료한 뒤 `data/` 폴더 전체를 복사합니다. 복원할 때도 서버를 종료한 상태에서 해당 폴더를 교체합니다. 앱은 이를 다음 시작 때 읽습니다.
- `data/`와 인증 정보는 Git에 포함하지 않습니다.

## 실행 설정

| 환경 변수            | 기본값                                     | 설명                                                                             |
| -------------------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| `HOST`               | `127.0.0.1`                                | 서버가 접속을 받을 주소. LAN 공유는 `0.0.0.0`. Compose 컨테이너 내부는 `0.0.0.0` |
| `PORT`               | `3210`                                     | 서버 포트                                                                        |
| `DATA_DIR`           | 프로젝트의 `data/`                         | 저장 폴더                                                                        |
| `ACCESS_CODE`        | 생성 후 파일에 보관                        | 원하는 접속 코드로 변경. 서버를 재시작해야 적용                                  |
| `PUBLIC_URL`         | 직접 실행은 자동 발견 · Docker는 localhost | 초대하기에 표시할 호스트의 외부 접속 주소                                        |
| `MCP_CONTAINER_NAME` | 직접 실행은 없음 · Compose는 ddd-builder   | Docker에서 MCP 실행에 사용할 컨테이너 이름                                       |
| `DDD_PORT`           | `3210`                                     | Compose가 호스트에 공개할 포트. 컨테이너 내부 포트는 3210                        |
| `DDD_BIND_ADDRESS`   | `127.0.0.1`                                | Compose의 호스트 접속 주소. LAN 공유는 `0.0.0.0`                                 |
| `DDD_CONTAINER_NAME` | `ddd-builder`                              | Compose 컨테이너 이름. 자동 MCP 설정에도 반영                                    |
| `DDD_URL`            | `http://127.0.0.1:3210`                    | MCP가 연결할 앱 주소                                                             |
| `DDD_CODE`           | 없음                                       | MCP 접속 코드 · 필수                                                             |
| `DDD_READ_ONLY`      | `true`                                     | MCP 카드 수정은 정확히 `false`로 지정할 때 허용                                  |
| `DDD_AI_NAME`        | `AI 도우미`                                | MCP 변경의 작성자 이름                                                           |

macOS/Linux 실행 예:

```sh
PORT=3300 npm start
```

## 개발 및 검증

```sh
npm run dev
```

API는 `3210`, 개발 화면은 `5173`에서 실행됩니다. 개발 화면은 API를 프록시합니다. 팀 사용은 빌드 후 단일 포트로 제공하는 `npm start`가 기본입니다.

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
# Docker가 실행 중인 환경에서 별도 임시 볼륨으로 통합 검증
npm run test:docker
```

Node 테스트는 임시 폴더에서 실제 HTTP와 MCP 클라이언트를 사용해 인증, 보안 헤더, 요청·세션·SSE 한도, 저장 복구, 충돌, 동시 요청, 내보내기와 stdio 연결을 검증합니다. 브라우저 테스트는 별도 포트 `3211`과 `test-results/e2e-data`를 사용합니다.
