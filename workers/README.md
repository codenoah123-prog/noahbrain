# noahflow Cloudflare 배포 설정

사용자 안내는 [웹으로 사용하기](../docs/CLOUDFLARE-START.md)를 참고합니다. 이 문서는 개발자용입니다.

## 구성

- Worker 진입점: `workers/index.mjs`
- 정적 화면: `dist/`, `ASSETS` 바인딩
- SQLite 호환 D1: `DB` 바인딩, `migrations/`
- 필수 Worker Secret: `ADMIN_PASSWORD`
- `/api`, `/auth`, `/webhooks` 및 하위 경로는 Worker가 먼저 처리하고, 화면은 SPA 정적 자산으로 제공합니다.
- `workers.dev` 기본 주소를 사용하며 도메인·유료 컨테이너·R2·Queues는 요구하지 않습니다.
- Wrangler 텔레메트리와 Worker 관찰 로그는 기본 설정에서 비활성화했습니다. 비밀값을 로그에 출력하지 않습니다.

## 자동 리소스 생성과 배포 버튼

현재 공식 Wrangler는 리소스 ID가 없는 D1 바인딩을 배포 시 자동으로 생성할 수 있습니다. `wrangler.jsonc`에는 다른 사람의 `database_id`나 계정 ID를 넣지 않습니다. Deploy to Cloudflare 흐름은 사용자 계정에 저장소와 D1을 만들고, 필요한 ID를 해당 배포 환경에 연결합니다.

버튼 형식:

```text
https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fcodenoah123-prog%2Fnoahbrain%2Ftree%2Fcloudflare-web
```

공식 문서는 `/tree/<ref>/<subdirectory>` 형태의 공개 저장소 URL을 예시로 사용합니다. 이 프로젝트는 슬래시가 없는 `cloudflare-web` 브랜치를 지정합니다. 최종 사용자에게 링크를 안내하기 전 브랜치 게시 성공을 확인하고, 실제 배포 완료 URL은 Cloudflare가 반환한 경우에만 안내합니다.

`.dev.vars.example`은 배포 폼에 `ADMIN_PASSWORD`라는 비밀 설정 이름만 알려 줍니다. 실제 값을 저장하지 않습니다. `package.json`의 `cloudflare.bindings.ADMIN_PASSWORD.description`으로 관리자 비밀번호 설명을 제공할 수 있습니다. 오래된 `.env.example`에 관련 없는 비밀 이름이 남아 있다면 배포 폼이 이를 요청할 수 있으므로 새 배포 경로와 맞춰 정리합니다.

## 개발 검증

Wrangler는 개발 의존성으로 고정하고 잠금 파일을 사용합니다. 빌드 후의 로컬 검증은 `wrangler dev`에서 수행할 수 있습니다. 로컬 검증용 `.dev.vars`는 Git에서 제외하고 테스트용 값만 사용합니다.

원격 D1 마이그레이션이 필요한 배포 스크립트에서는 데이터베이스 이름이 아닌 바인딩 이름을 사용합니다.

```text
wrangler d1 migrations apply DB --remote
```

단, 이 명령은 실제 사용자 계정의 원격 데이터베이스를 변경합니다. 로컬 검증에서 원격 명령을 자동 실행하지 않습니다. 최초 배포에서는 자동 생성된 D1에 Worker가 스키마를 안전하게 초기화하며, 리소스가 생성되기 전에 원격 마이그레이션을 실행하지 않습니다. 이후 스키마 변경에만 검토한 마이그레이션을 적용합니다.

`secrets.required`는 배포 전 비밀 설정 이름의 존재를 검증합니다. 비밀번호 강도·실제 Meta 권한·웹훅 수신·발송 성공을 검증하는 기능은 아닙니다. 무료 Workers의 CPU 시간·D1 읽기/쓰기·저장소 한도를 지켜야 하며, 한도를 늘리기 위한 유료 전환을 자동 수행하지 않습니다.

## 검증 상태

공식 Cloudflare 문서에서 Deploy 버튼, 비밀 설정 입력, D1 자동 생성, 필수 secret 선언과 정적 자산 라우팅 설정을 확인했습니다. 실제 사용자 계정에서 버튼 클릭·리소스 생성·원격 배포·Meta 연동이 완료된 상태는 아닙니다. 로컬 빌드·테스트 결과와 실제 배포 결과를 구분해서 보고합니다.
