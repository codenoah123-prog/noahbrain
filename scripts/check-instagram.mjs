import { pathToFileURL } from 'node:url';
import { probeInstagram } from '../server/instagram.mjs';

export async function checkInstagram() {
  const result = await probeInstagram();
  if (!result.ok) {
    console.error(`Instagram 읽기 검사 실패: ${result.error.code}`);
    console.error(result.error.message);
    if (result.readiness.missing.length) console.error(`없는 변수 이름: ${result.readiness.missing.join(', ')}`);
    if (result.readiness.invalid.length) console.error(`형식을 확인할 변수 이름: ${result.readiness.invalid.join(', ')}`);
    if (result.error.httpStatus) console.error(`HTTP 상태: ${result.error.httpStatus}`);
    if (result.error.graphCode !== undefined) console.error(`Meta 오류 코드: ${result.error.graphCode}`);
    if (result.error.graphSubcode !== undefined) console.error(`Meta 하위 오류 코드: ${result.error.graphSubcode}`);
    console.error('설정 안내: docs/INSTAGRAM-READINESS.md. 비밀번호나 토큰을 채팅에 보내지 마세요.');
    return 1;
  }
  console.log('Instagram 구독 정보 읽기 성공');
  console.log(`응답에 포함된 앱 수: ${result.subscriptions.appCount}`);
  console.log(`관찰한 구독 필드: ${result.subscriptions.fields.join(', ') || '없음'}`);
  console.log('이는 읽기 응답 확인일 뿐, 앱 일치·댓글 수신·DM 발송·팔로우 조회 검증이 아닙니다.');
  console.log('실제 메시지는 보내지 않았습니다.');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await checkInstagram();
}
