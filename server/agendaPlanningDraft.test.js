import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sj-agenda-draft-"));
process.env.DATABASE_PATH = path.join(testRoot, "calendar.sqlite");
process.env.UPLOADS_PATH = path.join(testRoot, "uploads");

const [{ default: db }, { default: express }, { default: agendaRouter }] = await Promise.all([
  import("./database/db.js"),
  import("express"),
  import("./routes/agenda.js"),
]);

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/agenda", agendaRouter);
  server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  db.close();
  const tempRoot = path.resolve(os.tmpdir());
  const resolvedTestRoot = path.resolve(testRoot);
  if (resolvedTestRoot.startsWith(`${tempRoot}${path.sep}`)) {
    await fs.rm(resolvedTestRoot, { recursive: true, force: true });
  }
});

test("planning draft persists in the local data file", async () => {
  const headers = { Origin: baseUrl };
  const emptyResponse = await fetch(`${baseUrl}/api/agenda/planning-draft`, { headers });
  assert.equal(emptyResponse.status, 200);
  assert.deepEqual((await emptyResponse.json()).items, []);

  const items = [
    { id: "draft-1", text: "Preparar pauta da reunião" },
    { id: "draft-2", text: "Uma ideia sem data" },
  ];
  const savedResponse = await fetch(`${baseUrl}/api/agenda/planning-draft`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  assert.equal(savedResponse.status, 200);
  assert.equal((await savedResponse.json()).success, true);

  const readResponse = await fetch(`${baseUrl}/api/agenda/planning-draft`, { headers });
  assert.deepEqual((await readResponse.json()).items, items);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(testRoot, "agenda-planning-draft.json"), "utf8")), items);

  await fs.writeFile(path.join(testRoot, "agenda-planning-draft.json"), JSON.stringify([null]));
  const corruptedResponse = await fetch(`${baseUrl}/api/agenda/planning-draft`, { headers });
  assert.equal(corruptedResponse.status, 500);
});

test("planning draft rejects invalid entries", async () => {
  const response = await fetch(`${baseUrl}/api/agenda/planning-draft`, {
    method: "PUT",
    headers: { Origin: baseUrl, "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ id: "duplicate", text: "A" }, { id: "duplicate", text: "B" }] }),
  });

  assert.equal(response.status, 400);
});

test("agenda item creation returns the scheduled appointment as JSON", async () => {
  const response = await fetch(`${baseUrl}/api/agenda/items`, {
    method: "POST",
    headers: { Origin: baseUrl, "Content-Type": "application/json" },
    body: JSON.stringify({
      item_type: "appointment",
      title: "Reunião arrastada da Lista",
      description: "",
      area: "personal",
      category: "",
      planned_date: "2026-11-16",
      due_date: null,
      start_time: "16:00",
      end_time: "17:00",
      priority: "normal",
      status: "scheduled",
      observations: "",
      client_id: null,
    }),
  });

  assert.equal(response.status, 201);
  const { item } = await response.json();
  assert.deepEqual({
    item_type: item.item_type,
    title: item.title,
    planned_date: item.planned_date,
    start_time: item.start_time,
    end_time: item.end_time,
    status: item.status,
  }, {
    item_type: "appointment",
    title: "Reunião arrastada da Lista",
    planned_date: "2026-11-16",
    start_time: "16:00",
    end_time: "17:00",
    status: "scheduled",
  });
});
