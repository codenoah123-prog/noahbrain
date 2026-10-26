const major = Number(process.versions.node.split(".")[0]);

if (major < 24) {
  console.error("noahflow에는 Node.js 24 이상이 필요합니다.");
  process.exitCode = 1;
} else {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");
    database.prepare("SELECT 1").get();
    database.close();
    console.log(`Node.js ${process.versions.node} / SQLite 실행 확인 완료`);
  } catch (error) {
    console.error(`SQLite 실행을 확인하지 못했습니다: ${error.message}`);
    process.exitCode = 1;
  }
}
