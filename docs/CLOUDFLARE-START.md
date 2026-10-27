# 웹사이트로 사용하기: 처음 한 번만 설정

이 방법은 Windows 실행 파일이나 ZIP을 내려받지 않습니다. 사이트를 내 Cloudflare 무료 계정에 배포한 뒤, 브라우저에서 주소를 열어 사용하는 방식입니다.

## 지금 할 일

1. [Cloudflare 무료 계정](https://dash.cloudflare.com/sign-up)을 만들고 로그인합니다.
2. [**Cloudflare에 배포하기**](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fcodenoah123-prog%2Fnoahbrain%2Ftree%2Fcloudflare-web)를 엽니다.
3. 화면에서 GitHub 계정을 연결하고, 이 앱용 새 저장소와 Worker를 만듭니다. 이름은 기본값을 사용해도 됩니다. 저장소 이름이 이미 사용 중이라고 나오면 `noahflow-web`처럼 새 이름을 선택합니다.
4. `ADMIN_PASSWORD` 입력란에는 **이 사이트에서 사용할 관리자 비밀번호를 20자 이상**으로 직접 정합니다. 인스타그램 비밀번호를 넣지 마세요. 이 값을 채팅으로 보내거나 저장소 파일에 적지 않습니다.
5. D1 데이터 저장소는 배포 설정을 읽어 자동으로 만들어집니다. **Workers Free** 계정에서만 진행하고, 유료 요금제나 카드 등록·도메인 구매를 요구하면 진행을 멈춥니다.
6. 배포가 끝나면 Cloudflare가 표시하는 `workers.dev` 사이트 주소를 엽니다. 이 주소는 사용자가 실제 배포한 뒤에만 생깁니다.

배포 버튼은 `cloudflare-web` 소스 브랜치를 사용합니다. 버튼을 준비했다는 것과 실제 사용자 계정에 배포를 완료한 것은 다릅니다.

Cloudflare는 버튼을 통해 원본 소스를 사용자 GitHub 계정으로 복사하고, 빌드·리소스 생성·배포를 수행합니다. 따라서 처음 한 번 GitHub 권한 확인 화면이 나올 수 있습니다. 유료 리소스는 이 프로젝트 설정에 포함하지 않았습니다.

## 사이트가 열린 뒤

1. 배포할 때 정한 관리자 비밀번호로 로그인합니다.
2. 사이트의 인스타그램 연결 안내를 따릅니다. 현재는 **Meta 앱에서 발급한 연결값을 처음 한 번 직접 입력하는 방식**입니다. 자동 Instagram 로그인 버튼으로 연결되는 버전은 아닙니다.
3. 로그인한 사이트의 전용 설정 화면에 Instagram 계정 ID, 해당 계정의 액세스 토큰, Meta 앱 시크릿, 앱이 지원하는 API 버전을 입력합니다. 앱 ID는 화면에서 요구하는 경우 함께 입력합니다. 이 값들은 본인 Meta 앱의 Instagram 로그인/API 설정에서 확인하며, 채팅이나 공개 GitHub 파일에 보내지 않습니다.
4. 사이트가 보여 주는 callback 주소와 검증값을 본인의 Meta 앱 웹훅 설정에 등록합니다. 필요한 댓글·메시지 권한과 이벤트 구독, 전문 계정 연결 상태도 확인합니다.
5. 계정 연결과 웹훅 수신을 실제로 확인한 다음 자동화 발송을 활성화합니다. 연결되지 않은 상태를 실발송 가능한 상태로 보지 않습니다.

배포된 사이트와 Meta 계정 연결은 별도 단계입니다. 배포 성공만으로 댓글·팔로우 조회나 DM 발송 권한이 확인되지는 않습니다. 액세스 토큰의 유효기간과 권한도 확인해야 하며, 만료되거나 취소되면 다시 발급해 사이트에 저장해야 할 수 있습니다. 영구 토큰이나 자동 갱신이 보장되는 구성으로 안내하지 않습니다.

## 관리자 비밀번호 입력란을 놓쳤을 때

배포가 비밀 설정 누락으로 멈췄거나 사이트가 설정 필요 화면을 보여 주면 다음 경로를 확인합니다.

**Cloudflare → Workers & Pages → 해당 앱 → Settings → Variables and Secrets → Add**

유형을 **Secret**, 이름을 **`ADMIN_PASSWORD`**, 값을 직접 정한 20자 이상 비밀번호로 설정하고 **Deploy**합니다. 비밀번호를 입력한 파일을 GitHub에 올리는 방법은 사용하지 않습니다.

관리자 비밀번호는 서버의 암호화·인증 기준으로도 사용되므로, 이미 데이터를 저장한 뒤 변경할 때는 앱의 안내와 백업 절차를 먼저 확인해야 합니다.

## 비용 기준

- 목표는 **추가 월 결제 0원**입니다. 월 10,000원 이상 필요한 구성은 사용하지 않습니다.
- Cloudflare Workers Free와 D1 무료 한도 안에서만 운영합니다. 계정에 이미 Workers Paid가 활성화되어 있다면 무료라고 가정하지 말고 현재 계정 요금부터 확인하세요.
- 무료 기본 주소와 HTTPS를 사용하므로 개인 도메인을 구매할 필요가 없습니다.
- 이 구성은 R2·유료 컨테이너·Queues·유료 외부 자동화 서비스를 요구하지 않습니다.
- 무료 한도는 제한이 있습니다. 제한 초과·API 권한 미승인·계정 정책으로 처리가 중단될 수 있으며, 실제 사용량과 계정 요금 상태를 확인하기 전 총비용을 보증하지 않습니다.

## 배포가 실패하면

보안 설정을 끄거나 카드·유료 플랜을 추가하지 마세요. Cloudflare의 배포 화면에 표시된 실패 단계와 오류 문구만 확인합니다. 토큰·비밀번호·앱 시크릿이 포함된 화면 전체를 공개하지 마세요.

일반 사용자는 `npm`, 터미널, Wrangler 설치가 필요하지 않습니다. 개발자가 직접 배포할 때 사용하는 명령은 별도 [배포 설정 설명](../workers/README.md)에 있습니다.

## 확인한 공식 자료

- [Deploy to Cloudflare 버튼](https://developers.cloudflare.com/workers/platform/deploy-buttons/): 저장소 복사, 자동 D1 생성, 비밀 설정 입력과 빌드·배포 흐름
- [Wrangler 자동 리소스 생성](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)
- [Cloudflare 비밀 설정](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 한도](https://developers.cloudflare.com/d1/platform/limits/)

공식 배포 흐름과 설정을 확인했으나, 이 작업에서 사용자의 Cloudflare 계정을 만들거나 리소스를 배포·과금하지 않았습니다.
