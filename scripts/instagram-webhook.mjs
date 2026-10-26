import { pathToFileURL } from 'node:url';

export async function startInstagramWebhook(env = process.env) {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 이상이 필요합니다.');
  const missing = ['META_APP_SECRET', 'INSTAGRAM_WEBHOOK_VERIFY_TOKEN'].filter(name => !env[name]?.trim());
  if (missing.length) throw new Error('설정이 필요합니다: ' + missing.join(', '));
  const port = Number(env.INSTAGRAM_WEBHOOK_PORT ?? 3002);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('INSTAGRAM_WEBHOOK_PORT는 0~65535의 정수여야 합니다.');
  const {createInstagramWebhook} = await import('../server/instagram-webhook.mjs');
  const app = createInstagramWebhook({appSecret: env.META_APP_SECRET, verifyToken: env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN, ...(env.INSTAGRAM_INBOX_DB_PATH ? {dbPath: env.INSTAGRAM_INBOX_DB_PATH} : {})});
  try {
    await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(port, '127.0.0.1', resolve); });
  } catch (error) { await app.close(); throw error; }
  console.log('Instagram 수신 전용 웹훅이 127.0.0.1:' + app.server.address().port + '에서 실행 중입니다. 경로: /webhooks/instagram');
  console.log('댓글/메시지 원문은 보관하지 않습니다. 실제 DM 발송은 비활성 상태입니다. 관리 화면 포트 3001을 공개하지 마세요.');
  const stop = async () => { await app.close(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return app;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startInstagramWebhook().catch(() => {
    const missing = ['META_APP_SECRET', 'INSTAGRAM_WEBHOOK_VERIFY_TOKEN'].filter(name => !process.env[name]?.trim());
    console.error(missing.length ? '설정이 필요합니다: ' + missing.join(', ') : '수신기를 시작하지 못했습니다. 포트·데이터 경로·Node 버전을 확인하세요.');
    process.exitCode = 1;
  });
}
