if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('Node.js 24 이상이 필요합니다.');
  process.exitCode = 1;
} else {
  try {
    const {readInstagramInbox} = await import('../server/instagram-webhook.mjs');
    const status = readInstagramInbox(process.env.INSTAGRAM_INBOX_DB_PATH);
    console.log(JSON.stringify(status, null, 2));
    if (!status.exists) console.log('아직 수신 기록이 없습니다. 데이터베이스를 새로 만들지 않았습니다.');
  } catch {
    console.error('수신 기록을 읽지 못했습니다. 데이터 경로와 파일 접근 권한을 확인하세요.');
    process.exitCode = 1;
  }
}
