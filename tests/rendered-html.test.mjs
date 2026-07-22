import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";

const PORT = 4327;
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
let server;
let serverOutput = "";

before(async () => {
  const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
  server = spawn(
    process.execPath,
    [nextBin, "start", "--port", String(PORT)],
    {
      cwd: projectRoot,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", (chunk) => { serverOutput += chunk; });
  server.stderr.on("data", (chunk) => { serverOutput += chunk; });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Next.js failed to start:\n${serverOutput}`);
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/`);
      if (response.ok) return;
    } catch {
      // Wait for the production server to accept connections.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Next.js:\n${serverOutput}`);
});

after(() => {
  server?.kill();
});

test("server-renders the local-first product shell", async () => {
  const response = await fetch(`http://127.0.0.1:${PORT}/`, {
    headers: { accept: "text/html" },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]*lang="zh-CN"/i);
  assert.match(html, /<title>续线｜先做眼前这一步<\/title>/i);
  assert.match(html, /正在打开/);
  assert.match(html, /class="loading-screen"/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("keeps one simple task model in a minimal interface", async () => {
  const [page, layout, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /indexedDB\.open/);
  assert.match(page, /type TaskStatus = "active" \| "later" \| "done"/);
  assert.match(page, /schemaVersion: 3/);
  assert.match(page, /plainTextToNoteHtml/);
  assert.match(page, /你的数据没有被改动/);
  assert.match(page, /快速添加任务，回车保存/);
  assert.match(page, /全部任务/);
  assert.match(page, /未完成/);
  assert.match(page, /已完成/);
  assert.match(page, /撤销/);
  assert.match(page, /任务名称/);
  assert.match(page, /备注 <small>可选/);
  assert.match(page, /openTaskEditor/);
  assert.match(page, /＋ 添加备注/);
  assert.match(page, /contentEditable/);
  assert.match(page, /insertUnorderedList/);
  assert.match(page, /insertOrderedList/);
  assert.match(page, /sanitizeNoteHtml/);
  assert.match(page, /aria-label="粗体"/);
  assert.match(page, /aria-label="下划线"/);
  assert.match(page, /reorderLaterTask/);
  assert.match(page, /拖动排序/);
  assert.match(page, /draggable/);
  assert.match(page, /role="alertdialog"/);
  assert.match(page, /提醒时间到了/);
  assert.match(page, /type="date"/);
  assert.match(page, /type="time"/);
  assert.match(page, /combineLocalDateAndTime/);
  assert.match(page, /data-display=/);
  assert.match(page, /openDateTimePicker/);
  assert.match(page, /可以从上方按钮快速选择/);
  assert.match(page, /弹窗提醒/);
  assert.doesNotMatch(page, /可选一个快捷时间/);
  assert.match(page, /shownReminders/);
  assert.match(page, /function exportBackup/);
  assert.match(page, /续线备份-/);
  assert.match(page, /导出备份/);
  assert.match(page, /function confirmImport/);
  assert.match(page, /导入备份/);
  assert.match(page, /覆盖并导入/);
  assert.match(page, /备份&amp;恢复/);
  assert.doesNotMatch(page, /已自动保存/);
  assert.match(page, /新建并切换/);
  assert.match(page, /switch-route-new/);
  assert.doesNotMatch(page, /给当前任务留信息（可选）/);
  assert.match(page, /accept="\.json,application\/json"/);
  assert.match(page, /放到稍后/);
  assert.match(page, /editDrafts/);
  assert.match(page, /暂时关闭不会丢失本次修改/);
  assert.match(page, /<details className="edit-reminder">/);
  assert.match(page, /if \(createdNewTask\)/);
  assert.doesNotMatch(page, /第一步/);
  assert.match(page, /稍后/);
  assert.match(page, /还要继续/);
  assert.match(page, /结束今天/);
  assert.doesNotMatch(page, /遗忘雷达|接力棒|近地轨道|attention continuity/);
  assert.match(page, /prefers-reduced-motion|aria-live|aria-modal/);
  assert.match(layout, /续线｜先做眼前这一步/);
  assert.match(layout, /\/favicon\.svg/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /calc\(100dvh - 142px\)/);
  assert.match(css, /\.rich-editor-toolbar/);
  assert.match(css, /\.datetime-picker-field/);
  assert.match(css, /list-style-type:\s*disc/);
  assert.match(css, /list-style-type:\s*decimal/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await access(new URL("../public/favicon.svg", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});
