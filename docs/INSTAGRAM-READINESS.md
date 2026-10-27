# 실제 Instagram 연동 준비

> Cloudflare 웹 버전의 설정·실발송 코드는 `workers/`에 있습니다. 아래 Node CLI 안내는 기존 진단 도구이며, 일반 사용자는 사이트의 계정 연결 화면을 사용합니다. 실제 계정 배포·발송 검증은 아직 미실행입니다.

확인일: 2026-10-26. 현재 앱은 **실제 Instagram에 연결하지 않는 테스트 모드**입니다. 아래 내용은 공식 자료를 확인한 결과이며, 사용자 계정에서 API 호출이나 실제 발송을 성공시킨 결과가 아닙니다.

## 확인한 공식 자료

Meta의 공식 `fbsamples/messenger-platform-samples` 저장소에 있는 [Instagram API Postman 컬렉션](https://github.com/fbsamples/messenger-platform-samples/blob/3c3853a84a5d87d2567e75e649655822f535fdf6/postman/instagram-platform-api.postman_collection.json)을 읽었습니다. 확인한 저장소 HEAD는 `3c3853a84a5d87d2567e75e649655822f535fdf6`입니다. 개발자 문서 사이트와 Socian 사이트는 이 환경에서 프록시 `403`으로 열리지 않았지만, 공식 GitHub 자료는 확인했습니다.

컬렉션의 다음 경로를 근거로 사용합니다.

- `Instagram API with Instagram Login > Send API > Private Replies`
- `Instagram API with Instagram Login > Instagram User Profile API`
- `Instagram API with Instagram Login > Send API > Media Message (Photo or GIF)`
- `Instagram API with Instagram Login > Send API > Templates > Button Template`

자료의 요청 예시에 등장하는 `v23.0`을 최신 API 버전이라고 가정하지 않습니다. 실제 연동 시 앱에서 선택한 지원 버전을 확인해야 합니다.

## 구현 가능한 흐름과 중요한 제약

공식 자료에는 비즈니스 또는 크리에이터 **전문 계정**이 소유한 게시물·릴스 댓글에 비공개 답장을 보내는 경로가 있습니다. 일반 개인 계정에서도 동일하게 사용할 수 있다고 가정하지 않습니다.

최초 댓글 DM은 다음 조건을 따릅니다.

- “Only one message can be sent to the commenter”: 댓글을 계기로 한 최초 비공개 메시지는 1회입니다.
- “The message must be sent within 7 days”: 게시물·릴스 댓글 작성 후 7일 이내에 보내야 합니다.
- “Follow-up messages can only be sent if the recipient responds”: 후속 메시지는 수신자가 응답한 뒤에만 보낼 수 있으며, 그 응답 후 24시간 안에 보내야 합니다.

팔로우 여부를 나타내는 `is_user_follow_business` 필드는 공식 User Profile API 자료에 있습니다. 그러나 **댓글을 남긴 사실만으로 프로필 조회 동의가 생기지는 않습니다.** 자료에는 다음과 같이 명시되어 있습니다.

> User consent is set only when an Instagram user sends a message to your app user, or clicks an icebreaker or persistent menu.

따라서 팔로우 조건이 있는 자동화는 다음 순서로 검증해야 합니다.

1. 게시물·릴스의 키워드 댓글을 수신합니다.
2. 최초 DM 1회로 “계정을 팔로우한 뒤 이 DM에 ‘확인’이라고 답장해 주세요”라고 안내합니다.
3. 참여자의 실제 DM 답장을 `messages` 웹훅으로 받습니다.
4. 그 메시지에서 받은 Instagram-scoped ID로 `is_user_follow_business`를 조회합니다.
5. 조회 결과가 명확히 `true`이고 응답 가능한 시간 안에 있으면 자료를 보냅니다. 결과가 `false`, 확인 불가, 오류 또는 시간 초과이면 발송 대기로 남깁니다.

이미 팔로워여도 프로필 조회 동의가 없는 최초 접촉이라면 답장 단계가 필요할 수 있습니다. 팔로우를 한 것만으로 후속 DM 발송 동의나 메시지 응답 시간이 자동으로 생긴다고 가정하지 않습니다. 일반 버튼 클릭만으로 이 조건이 충족된다고도 가정하지 않습니다.

이미지 URL과 링크 버튼은 일반 메시지 전송 예시에 있습니다. 이를 최초 댓글 DM에서 여러 메시지로 제한 없이 보낼 수 있다는 뜻으로 해석하지 않습니다. 초기 검증은 텍스트 안내 1회로 시작하고, 참여자가 응답한 뒤 일반 메시지 경로에서 이미지·링크를 검증합니다.

## 권한과 계정 준비

개인 사용에서는 우선 **Instagram Login 방식**을 검토합니다. 공식 자료에서 확인되는 최소 권한 구분은 다음과 같습니다.

| 기능                          | Instagram Login 권한                                             |
| ----------------------------- | ---------------------------------------------------------------- |
| 기본 계정 및 댓글 비공개 답장 | `instagram_business_basic`, `instagram_business_manage_comments` |
| 프로필 조회와 일반 메시지     | `instagram_business_basic`, `instagram_business_manage_messages` |

필요한 댓글 이벤트는 `comments`, DM 응답 이벤트는 `messages`입니다. 서명 검증을 갖춘 공개 HTTPS 웹훅 수신 경로와 계정 연결 절차가 필요합니다.

공식 자료에는 본인이 소유·관리하고 App Dashboard에 추가한 전문 계정은 Standard Access, 다른 사람의 전문 계정에 서비스를 제공하면 Advanced Access를 사용하는 구분이 있습니다. 이것만으로 모든 앱 심사나 권한 승인이 면제된다고 단정하지 않습니다. 실제 앱 대시보드의 상태와 계정 권한을 확인해야 합니다.

Facebook Login 방식은 `graph.facebook.com`, Facebook Page access token 및 `instagram_basic` 등 다른 권한을 사용합니다. 그 방식의 자료는 전문 계정과 Facebook Page 연결을 전제로 합니다. 두 로그인 방식의 토큰·권한·호스트를 섞지 않습니다.

## 사용자 계정 준비 상태

사용자는 전문 계정과 Meta 개발자 앱이 있으며 **Instagram 로그인 방식**으로 설정했다고 확인했습니다. 비밀값은 제공받지 않았고 실제 API 요청은 실행하지 않았습니다.

### 1. Codespaces 비밀 설정

GitHub의 사용자 **Settings → Codespaces → Secrets**에서 이 저장소를 사용할 수 있게 선택하여 아래 이름을 추가합니다. 저장소의 Actions secrets나 채팅이 아닙니다. 환경에 추가·변경한 값이 반영되도록 Codespace를 다시 시작한 뒤 앱을 다시 실행합니다.

| 변수 이름                | 입력할 내용                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `INSTAGRAM_LOGIN_MODE`   | 비밀이 아닌 고정 문자열 `instagram`                                                      |
| `INSTAGRAM_API_VERSION`  | 본인 Meta 앱에서 지원하는 명시적인 `v숫자.숫자` 버전. 샘플 버전을 최신으로 추측하지 않음 |
| `INSTAGRAM_ACCOUNT_ID`   | 앱과 연결한 전문 Instagram 계정의 숫자 ID. 사용자명이나 Meta 앱 ID와 다름                |
| `INSTAGRAM_ACCESS_TOKEN` | 그 계정·앱의 Instagram User access token. 실제 값은 채팅·소스·화면에 넣지 않음           |

개인 PC 개발에서는 Git에서 제외된 `.env`를 사용할 수 있고 `docs/instagram-node-env.example`의 빈 항목을 참고합니다. 저장소에는 실제 값을 넣지 않습니다.

### 2. 읽기 전용 구독 확인

```bash
npm run instagram:check
```

공식 컬렉션에 있는 `GET https://graph.instagram.com/{api_version}/{ig_user_id}/subscribed_apps`를 Bearer 헤더로 요청합니다. `data[].subscribed_fields` 중 `comments`, `messages` 등을 확인하며, 구독을 등록하거나 DM을 보내지 않습니다. 로그에는 토큰, 계정 ID, 앱 ID나 Meta 원본 오류를 출력하지 않습니다.

앱의 **계정 및 설정 → 읽기 전용 구독 확인**에서도 실행할 수 있습니다. 자격 증명은 서버 설정만 사용하고 브라우저에서 받지 않습니다. 다른 앱의 구독이 섞여 있을 수 있어 본인 Meta 앱 일치, 실제 이벤트 수신, DM 권한, 팔로우 조회까지 성공했다고 표시하지 않습니다. `liveSendingEnabled`는 항상 `false`입니다.

### 3. 서명 검증된 댓글 이벤트 1건 수신

추가로 Codespaces secrets에 `META_APP_SECRET`과 `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`을 설정합니다. 전자는 실제 Meta 앱의 비밀값이며, 후자는 Meta callback 검증에 동일하게 입력할 충분히 긴 임의의 비밀 문자열입니다. 비밀값을 채팅이나 GitHub 파일로 보내지 않습니다.

```bash
npm run instagram:webhook
```

별도 수신기가 loopback의 **3002** 포트에서 시작됩니다. **관리 앱 포트 3001은 계속 Private로 유지합니다.** 실제 Meta 연결을 테스트할 때만 Ports에 3002를 추가하여 수신기만 외부 HTTPS 주소로 전달합니다. 공개하면 되는 서버는 challenge와 서명 수신 경로만 제공하는 이 수신기입니다. 해당 주소의 `/webhooks/instagram`을 Meta 앱의 callback URL로 설정하고, 같은 verify token을 사용합니다. 앱의 `comments`/`messages` 구독 설정은 본인 대시보드에서 확인합니다. 이 코드는 구독 설정을 변경하지 않습니다.

- GET challenge 검증: `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`
- POST: 원문에 대한 `X-Hub-Signature-256` HMAC-SHA256·constant-time 검증, 256KB 제한
- SQLite: 수신 해시·시간·이벤트 종류·건수만 보관. 댓글 원문·사용자명·토큰은 저장하지 않음
- 중복 수신은 한 번만 기록. 메시지 전송이나 자동화는 실행하지 않음

새 터미널에서 다음 명령으로 수신 영수증만 확인합니다.

```bash
npm run instagram:inbox
```

callback 주소는 생성한 Codespace에서만 알 수 있으며 이 작업에서는 생성·공개·Meta 등록을 수행하지 않았습니다. 단기 수신 검증 후 수신기를 종료하고 3002 전달을 닫습니다. Codespaces의 공개 포트 사용 가능 여부는 계정·조직 정책에 따라 달라질 수 있습니다.

### 4. 다음 실발송 검증

댓글 수신 성공 이후, 대상과 내용이 명시적으로 승인된 테스트 댓글 1건에 최초 안내 DM 1건을 보내고 참여자의 실제 답장을 받아야 합니다. 그 이후 팔로우 필드 조회와 허용된 시간 안의 자료 발송을 검증합니다. 현재 실제 발송·프로필 조회·OAuth·토큰 갱신은 구현하지 않았습니다. 각각의 성공 응답과 제한을 확인하기 전에는 실발송 준비가 끝났다고 표시하지 않습니다.

월 추가 결제 0원이 목표이며, 유료 서버·별도 DB·자동화 구독은 사용하지 않습니다. Codespaces는 무료 제공량과 과금 차단을 확인하는 단기 검증용입니다. 최종 PC 운영용 무료 HTTPS 중계의 현재 조건과 상시 유지 가능성은 아직 검증하지 않았습니다.
