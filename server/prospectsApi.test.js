import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import test, { after, before } from "node:test";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sj-prospects-"));
process.env.DATABASE_PATH = path.join(testRoot, "prospects.sqlite");

const [{ default: db }, { default: express }, { default: prospectsRouter }] = await Promise.all([
  import("./database/db.js"),
  import("express"),
  import("./routes/prospects.js"),
]);

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/prospects", prospectsRouter);
  server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  db.close();
  const tempRootPath = path.resolve(os.tmpdir());
  const resolvedTestRoot = path.resolve(testRoot);
  if (resolvedTestRoot.startsWith(`${tempRootPath}${path.sep}`)) {
    fs.rmSync(resolvedTestRoot, { recursive: true, force: true });
  }
});

test("requires a follow-up date before moving a prospect to future interest", async () => {
  const stagesResponse = await fetch(`${baseUrl}/api/prospects/stages`);
  const { stages } = await stagesResponse.json();
  const stage = stages.find((item) => item.stage_key === "future_interest");
  assert.ok(stage);
  assert.equal(stage.name, "Adiado / Futuro interesse");

  const createResponse = await fetch(`${baseUrl}/api/prospects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company_name: "Prospect futuro", next_action_date: "2027-04-19" }),
  });
  const { prospect } = await createResponse.json();
  assert.equal(createResponse.status, 201);

  const missingDateResponse = await fetch(`${baseUrl}/api/prospects/${prospect.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage_id: stage.id }),
  });
  assert.equal(missingDateResponse.status, 400);
  assert.equal(db.prepare("SELECT stage_key FROM acquisition_stages WHERE id = ?").get(prospect.stage_id).stage_key, "new");

  const followUpDate = "2027-05-20";
  const moveResponse = await fetch(`${baseUrl}/api/prospects/${prospect.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage_id: stage.id, next_action_date: followUpDate }),
  });
  const { prospect: updated } = await moveResponse.json();
  assert.equal(moveResponse.status, 200);
  assert.equal(updated.stage_key, "future_interest");
  assert.equal(updated.next_action, "Follow-up");
  assert.equal(updated.next_action_date, followUpDate);
});
