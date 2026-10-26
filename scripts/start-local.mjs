import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function startLocal() {
  if (Number(process.versions.node.split(".")[0]) < 24) {
    throw new Error(
      "Node.js 24 이상이 필요합니다. https://nodejs.org/ 에서 설치해 주세요.",
    );
  }
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const staticDir = join(root, "dist");
  if (!existsSync(join(staticDir, "index.html"))) {
    throw new Error(
      "빌드된 화면이 없습니다. 소스 폴더에서 npm ci 후 npm run build 를 실행해 주세요.",
    );
  }
  const explicitPort = process.env.PORT !== undefined;
  const port = explicitPort ? Number(process.env.PORT) : 3001;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(
      "PORT는 0~65535의 정수여야 합니다. 0은 자동 포트 선택입니다.",
    );
  }
  const { createApp } = await import("../server/app.mjs");
  const app = createApp({
    dbPath: process.env.DB_PATH || join(root, "data", "noahbrain.sqlite"),
    staticDir,
  });
  const listen = (requestedPort) =>
    new Promise((resolve, reject) => {
      const failed = (error) => reject(error);
      app.server.once("error", failed);
      app.server.listen(requestedPort, "127.0.0.1", () => {
        app.server.off("error", failed);
        resolve();
      });
    });
  try {
    try {
      await listen(port);
    } catch (error) {
      if (!explicitPort && error.code === "EADDRINUSE") await listen(0);
      else throw error;
    }
  } catch (error) {
    app.store.close();
    throw error;
  }
  const address = `http://127.0.0.1:${app.server.address().port}`;
  console.log("\nnoahflow 개인용 테스트 앱을 실행했습니다.");
  console.log(`브라우저 주소: ${address}`);
  console.log(
    "개인 PC에서는 위 주소를 브라우저에 직접 입력하세요. Codespaces에서는 Ports 탭의 비공개 포트 미리보기를 여세요.",
  );
  console.log("이 창을 열어 두세요. 종료하려면 Ctrl+C를 누르세요.");
  console.log("테스트 모드: 실제 Instagram 댓글/DM은 전송되지 않습니다.\n");
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await app.close();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  return { ...app, address };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  startLocal().catch((error) => {
    console.error(`\n실행하지 못했습니다: ${error.message}`);
    process.exitCode = 1;
  });
}
