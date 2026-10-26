# noahflow · 브라우저 검증용 소스

내 게시물·릴스의 키워드 댓글을 계기로 DM 자동화 흐름을 설정하는 개인용 앱입니다. **자동화와 메시지 발송 화면은 샘플 테스트 모드이며 실제 DM을 보내지 않습니다.** 서버 설정 후 사용할 수 있는 실제 API 기능은 읽기 전용 구독 조회와, 별도로 시작하는 서명 검증 웹훅 수신기뿐입니다. 실제 계정에서 이 두 기능을 성공시킨 결과도 아직 없습니다.

기존 Windows ZIP은 Edge의 바이러스 감지 경고로 배포를 중단했습니다. 이 브랜치는 소스를 브라우저 개발 환경에서 검증하는 용도이며 Windows 백신 검사 통과나 보안 차단 해제를 뜻하지 않습니다. ZIP 생성과 배치 자동 실행기는 제공하지 않습니다. [보안 검토 상태](docs/SECURITY-STATUS.md)

## 먼저 브라우저에서 실행하기

1. GitHub 계정의 Codespaces 무료 잔량과 **유료 사용 차단**을 확인합니다. 이 작업에서 유료 서비스를 신청하거나 Codespace를 대신 생성하지 않았습니다.
2. [소스 브랜치](https://github.com/codenoah123-prog/noahbrain/tree/codex/browser-test)에서 **Code → Codespaces**로 2코어 환경을 만듭니다.
3. 처음 설치·빌드·테스트가 끝나면 터미널에서 `npm run browser`를 실행합니다.
4. **Ports → 3001 → Private 확인 → Open in Browser**로 앱을 엽니다. 실제 앱 주소는 사용자가 만든 Codespace에서 제공됩니다.

[그림 없이 따라가는 상세 실행 안내](docs/CODESPACES.md)

Codespaces는 무료 제공량 안에서 단기 검증하는 용도입니다. 중지해도 보관 중인 환경의 저장 공간은 계산됩니다. 필요한 데이터를 보관한 뒤 사용하지 않는 환경을 삭제할 수 있습니다. 앱 자체는 추가 월 결제 0원, 반드시 월 10,000원 미만이라는 사용자 조건을 따릅니다. 최종 운영은 기존 PC와 SQLite가 목표이며 기존 인터넷·전기료는 별도입니다.

## 구현된 테스트 기능

- 게시물·릴스별 자동화 생성·수정·삭제·활성/중지
- 모든 댓글 또는 최대 10개 키워드 중 하나의 일치 조건
- 텍스트·공개 이미지 URL·최대 3개 링크 버튼과 자동 답글 구성
- 팔로우 상태를 가정한 대기→발송 테스트, 개인화, 중복 이벤트 방지
- SQLite에 설정·기록 유지, 검색·상태 필터·CSV 내보내기

**실제 팔로우 조건은 댓글만으로 판정할 수 없습니다.** 공식 Meta 자료를 기준으로 검증할 흐름은 키워드 댓글 → 최초 안내 DM 1회 → 상대의 ‘확인’ DM 답장 → 팔로우 여부 조회 → 허용된 시간 안에 자료 발송입니다. 현재 화면의 확인 버튼은 이 단계를 가정한 시뮬레이션입니다.

## Instagram 로그인 연동 준비

사용자는 전문 계정과 Meta 앱을 보유하고 Instagram 로그인 방식으로 설정했다고 확인했습니다. 실제 토큰과 계정 ID는 이 저장소나 현재 실행 환경에 없습니다.

[계정 설정·읽기 전용 조회·웹훅 검증 안내](docs/INSTAGRAM-READINESS.md)

```bash
npm run instagram:check
```

서버에 준비된 변수만 사용해 공식 `graph.instagram.com`의 구독 조회를 GET으로 요청합니다. 구독 등록·메시지 발송·팔로우 조회를 수행하지 않습니다. 설정이 없으면 변수 이름만 표시하고 종료합니다. 토큰·앱 비밀값은 채팅, 프런트엔드 또는 Git에 넣지 마세요.

앱의 **계정 및 설정** 화면에서도 설정 유무와 ‘읽기 전용 구독 확인’을 사용할 수 있습니다. 성공 응답은 구독 정보 읽기만 확인하며 실제 댓글 수신·본인 Meta 앱 일치·발송 권한·팔로우 상태를 증명하지 않습니다.

실제 댓글 이벤트를 수신하는 첫 검증은 별도의 수신기에서 수행합니다.

```bash
npm run instagram:webhook
npm run instagram:inbox
```

수신기는 **3002번 포트**에서 challenge와 원문 HMAC-SHA256 서명을 검증하고, SQLite에 수신 해시·시간·종류·건수만 기록합니다. 댓글 원문과 사용자명은 저장하지 않습니다. 발송이나 자동화 실행은 하지 않습니다. 외부 수신이 필요한 경우 이 수신기 포트만 대상으로 하고, 관리 앱 3001은 Private로 유지합니다. 실제 Meta callback 등록과 서명 이벤트 수신은 아직 실행하지 않았습니다.

## 소스 개발 명령

Node.js 24 이상과 내장 SQLite가 필요합니다. 별도 DB 서버는 없습니다.

```bash
npm ci --no-audit --no-fund
npm run check:runtime
npm run build
npm test
npm run browser
```

개발 중 Vite가 필요하면 `npm run dev`를 사용합니다. 사전 빌드 소스를 개인 PC에서 수동으로 시작할 때는 `npm run local`을 사용합니다. 자동 브라우저 실행·CMD·실행 ZIP은 없습니다. `npm run package:local`은 배포 보류 안내와 종료 코드 1을 반환합니다.

Python Playwright와 Chromium이 준비된 개발 환경에서는 `python3 scripts/browser-smoke.py`로 별도 임시 DB를 사용해 PC·모바일 화면과 생성·수정·삭제·팔로우 대기·기록 유지 흐름을 검증할 수 있습니다.

## 데이터·비밀 설정

앱 데이터는 `data/noahbrain.sqlite`, 수신 영수증은 `data/instagram-inbox.sqlite`에 보관됩니다. 서버를 종료한 뒤 `data/` 전체를 백업하세요. 기본 샘플은 처음 한 번만 생성합니다. 앱 DB는 `DB_PATH`, 수신 DB는 `INSTAGRAM_INBOX_DB_PATH`로 별도 지정할 수 있습니다.

`data/`, 실제 `.env`, 의존성, 빌드 결과, 이전 ZIP과 생성 화면 자료는 Git에서 제외합니다. `.env.example`에는 빈 항목과 비밀이 아닌 로그인 방식만 있습니다. Codespaces에서는 저장소를 선택한 **Codespaces secrets**를 사용하고 추가·변경 후 환경을 다시 시작합니다. Actions secrets와는 다릅니다.

관리 앱에는 별도 사용자 인증이 없으므로 로컬 loopback 또는 Codespaces의 Private 포트에서만 사용합니다. 서명된 웹훅 수신 경로와 관리 API를 분리했습니다. 실제 DM·OAuth·토큰 갱신·팔로우 조회·과거 댓글 일괄 전송·새 팔로워만의 DM·파일 업로드·상시 무료 중계는 아직 구현하거나 검증하지 않았습니다.
