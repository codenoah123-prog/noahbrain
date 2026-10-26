import test from "node:test";
import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

function fixture({ built = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "noahflow 소스 실행 "));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "server"));
  copyFileSync(
    fileURLToPath(new URL("../scripts/start-local.mjs", import.meta.url)),
    join(root, "scripts/start-local.mjs"),
  );
  copyFileSync(
    fileURLToPath(new URL("../server/app.mjs", import.meta.url)),
    join(root, "server/app.mjs"),
  );
  copyFileSync(
    fileURLToPath(new URL("../server/instagram.mjs", import.meta.url)),
    join(root, "server/instagram.mjs"),
  );
  if (built) {
    mkdirSync(join(root, "dist"));
    writeFileSync(
      join(root, "dist/index.html"),
      "<!doctype html><title>local source test</title>source app ready",
    );
  }
  return root;
}

async function launch(root) {
  const env = { ...process.env, PORT: "0" };
  delete env.DB_PATH;
  const child = spawn(
    process.execPath,
    [join(root, "scripts/start-local.mjs")],
    {
      cwd: tmpdir(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const address = await new Promise((resolve, reject) => {
    let output = "";
    let error = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error("Source launcher did not become ready: " + output + error),
      );
    }, 6000);
    child.stderr.on("data", (data) => {
      error += data;
    });
    child.stdout.on("data", (data) => {
      output += data;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    child.on("error", (failure) => {
      clearTimeout(timer);
      reject(failure);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Source launcher exited before readiness (${code}): ${error}`,
        ),
      );
    });
  });
  return { child, address };
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Source launcher did not stop"));
    }, 4000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

test("manual source startup serves UI and API from a Korean/spaced folder and keeps its database across restarts", async () => {
  const root = fixture();
  let processRun;
  try {
    processRun = await launch(root);
    const health = await fetch(processRun.address + "/api/health");
    assert.deepEqual(await health.json(), {
      ok: true,
      mode: "demo",
      liveConnected: false,
    });
    assert.match(
      await (await fetch(processRun.address)).text(),
      /source app ready/,
    );
    const result = await fetch(processRun.address + "/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        automationId: "automation-guide",
        username: "local_tester",
        comment: "가이드 요청합니다",
        isFollower: true,
      }),
    });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).delivery.status, "sent");
    await stop(processRun.child);
    processRun = undefined;
    assert.equal(existsSync(join(root, "data/noahbrain.sqlite")), true);
    processRun = await launch(root);
    const overview = await (
      await fetch(processRun.address + "/api/overview")
    ).json();
    assert.equal(overview.stats.sent, 1);
  } finally {
    if (processRun) await stop(processRun.child);
    rmSync(root, { recursive: true, force: true });
  }
});

test("manual source startup fails before creating data if the UI has not been built", () => {
  const root = fixture({ built: false });
  try {
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts/start-local.mjs")],
      { cwd: tmpdir(), encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /npm run build/);
    assert.equal(existsSync(join(root, "data")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
