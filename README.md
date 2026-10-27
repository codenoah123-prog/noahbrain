# noahflow · 내 전용 Instagram 자동화

다운로드나 터미널 대신, 내 Cloudflare 무료 계정에 웹사이트를 한 번 설치해 브라우저로 사용하는 버전입니다.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fcodenoah123-prog%2Fnoahbrain%2Ftree%2Fcloudflare-web)

## 처음 시작하기

1. [Cloudflare 무료 계정](https://dash.cloudflare.com/sign-up)으로 로그인합니다.
2. 위 배포 버튼을 누르고 GitHub 연결을 허용합니다. 새 저장소 이름이 필요하면 `noahflow-web`처럼 정합니다.
3. `ADMIN_PASSWORD`에는 **이 사이트 관리자용 비밀번호**를 20자 이상 정합니다. 인스타그램 비밀번호가 아닙니다.
4. **Deploy** 후 나타나는 사이트 주소를 엽니다. 이후에는 사이트 안의 단계별 안내를 따릅니다.

도메인 구매·유료 플랜·카드 등록은 요구하지 않습니다. Workers Free 계정과 D1 무료 한도 안에서만 사용합니다. 유료 전환을 요구하면 진행을 멈춥니다. [자세한 실행 안내](docs/CLOUDFLARE-START.md)

## 사이트에서 처음 한 번 연결

관리자 비밀번호로 로그인한 뒤 Meta 앱 ID·앱 비밀값·Instagram 계정 ID·액세스 토큰을 **로그인한 사이트의 설정 화면에만** 입력합니다. 인스타그램 로그인 비밀번호는 받지 않습니다. 자동 OAuth 로그인 대신 이미 보유한 Meta 앱의 연결값을 등록하는 방식입니다.

화면의 웹훅 주소와 검증값을 Meta 앱에 등록하고, 댓글·메시지 이벤트 구독을 연결합니다. 실제 발송은 처음에는 꺼져 있습니다. 계정·앱 일치, 웹훅 검증, 구독 확인 후 명시적으로 켭니다. 토큰 만료·권한 취소 시 다시 연결해야 할 수 있습니다. 비밀값을 채팅·GitHub 파일에 보내지 마세요.

## 자동화 흐름

게시물·릴스의 키워드 또는 모든 댓글에 반응하도록 설정하고, 텍스트·공개 HTTPS 이미지·링크 버튼을 구성합니다.

**키워드 댓글 → 안내 DM 1회 → 상대의 ‘확인’ 답장 → 필요하면 팔로우 조회 → 자료 발송** 순서입니다. 댓글만으로 프로필 조회 동의가 생긴다고 가정하지 않습니다. 첫 비공개 답장은 댓글당 1회·7일 이내, 후속 메시지는 실제 답장 이후 24시간 내 조건을 적용합니다.

중복 이벤트와 동시 확인 답장을 선점하며, 전송 결과가 불확실하면 자동 재전송하지 않습니다. 실제 텍스트는 최대 1,000자이고 초기 동기화는 최근 콘텐츠 25개입니다. [공식 API 근거](docs/INSTAGRAM-READINESS.md)

## 비용·보안

추가 월 결제 0원이 목표이며 월 10,000원 이상 필요한 구성은 제외합니다. Worker·D1·기본 HTTPS 주소만 사용하고 유료 컨테이너·R2·Queues·외부 자동화 구독은 요구하지 않습니다. 무료 한도나 Meta 권한 제한으로 처리가 멈출 수 있으며 유료 플랜으로 자동 전환하지 않습니다.

토큰·앱 비밀값은 D1에 AES-GCM으로 암호화합니다. 관리자는 HttpOnly·Secure 쿠키로 로그인하며 변경 요청에는 Origin·CSRF 검증을 적용합니다. 서명이 확인된 웹훅만 처리합니다. 관리자 비밀번호 변경 시 계정 재연결이 필요합니다. [개발자 설정 설명](workers/README.md)

## 검증 상태

로그인·CSRF·D1·암호화·웹훅 서명·중복 방지·모의 Meta 응답 기반 실제 처리 코드를 테스트했습니다. Wrangler 로컬 실행에서 로그인·설정·화면 조작과 모바일 표시도 확인했습니다.

**사용자 Cloudflare 계정의 실제 배포와 실제 Instagram 발송은 아직 검증하지 않았습니다.** 자격 증명이 없어 실제 Meta 요청이나 메시지 전송은 수행하지 않았습니다. 배포 성공만으로 권한·실발송·무료 플랜 내 실행이 검증된 것은 아닙니다.

기존 Windows ZIP은 보안 경고로 배포 중단 상태를 유지합니다. 이번 버전은 서버에서 동작하는 웹 소스이며 보안 차단 해제를 요구하지 않습니다. [기존 배포 보류 기록](docs/SECURITY-STATUS.md)

## 개발자 검증

일반 사용자는 아래 명령을 실행하지 않습니다. Node.js 24 이상에서 다음으로 검증합니다.

```bash
npm ci --no-audit --no-fund
npm test
npm run build
npm run cf:check
```

기본 빌드는 Cloudflare용입니다. 로컬 Worker는 Git에서 제외된 `.dev.vars`에 테스트 관리자 비밀번호를 설정하고 `npm run cf:dev`로 실행합니다. `npm run deploy`는 실제 원격 계정에 배포하므로 인증·요금 상태를 확인한 경우에만 실행합니다.

기존 Node·Codespaces 버전은 `codex/browser-test` 브랜치에 남아 있습니다. 이 소스에서 Node API를 검증할 때는 `npm run build:node` 후 기존 브라우저 테스트를 실행합니다. 실제 `.dev.vars`, `.env`, DB·토큰·ZIP은 소스에 포함하지 않습니다.
