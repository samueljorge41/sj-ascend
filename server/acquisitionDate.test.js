import test from "node:test";
import assert from "node:assert/strict";
import { getAcquisitionFunnelCounts } from "../src/lib/acquisitionAnalytics.js";
import { acquisitionBusinessDate } from "../src/lib/acquisitionDate.js";

test("converts SQLite UTC timestamps to São Paulo calendar dates", () => {
  assert.equal(acquisitionBusinessDate("2026-10-31 00:21:38"), "2026-10-30");
  assert.equal(acquisitionBusinessDate("2026-10-31 02:59:59"), "2026-10-30");
  assert.equal(acquisitionBusinessDate("2026-10-31 03:00:00"), "2026-10-31");
});

test("preserves date-only and manually recorded local history dates", () => {
  assert.equal(acquisitionBusinessDate("2026-10-30"), "2026-10-30");
  assert.equal(acquisitionBusinessDate("2026-10-30T12:00:00"), "2026-10-30");
});

test("converts ISO timestamps with an explicit timezone", () => {
  assert.equal(acquisitionBusinessDate("2026-10-31T00:21:38Z"), "2026-10-30");
});

test("counts only explicitly reached funnel stages in the new-stage cohort", () => {
  const range = { start: "2026-10-01", end: "2026-10-30" };
  const counts = getAcquisitionFunnelCounts([
    { id: 1, prospect_id: 1, stage_key: "new", entered_at: "2026-10-31 00:21:38", is_estimated: 0 },
    { id: 2, prospect_id: 1, stage_key: "contacted", entered_at: "2026-10-31 01:00:00", is_estimated: 0 },
    { id: 3, prospect_id: 1, stage_key: "proposal_sent", entered_at: "2026-10-31 02:00:00", is_estimated: 0 },
    { id: 4, prospect_id: 1, stage_key: "negotiation", entered_at: "2026-10-31 02:15:00", is_estimated: 0 },
    { id: 5, prospect_id: 1, stage_key: "closed", entered_at: "2026-10-31 02:30:00", is_estimated: 0 },
    { id: 6, prospect_id: 2, stage_key: "new", entered_at: "2026-10-31 00:30:00", is_estimated: 0 },
    { id: 7, prospect_id: 2, stage_key: "lost", entered_at: "2026-10-31 01:30:00", is_estimated: 0 },
    { id: 8, prospect_id: 3, stage_key: "new", entered_at: "2026-09-30 20:00:00", is_estimated: 0 },
    { id: 9, prospect_id: 3, stage_key: "closed", entered_at: "2026-10-10 20:00:00", is_estimated: 0 },
    { id: 10, prospect_id: 4, stage_key: "new", entered_at: "2026-10-10 12:00:00", is_estimated: 0 },
    { id: 11, prospect_id: 4, stage_key: "proposal_sent", entered_at: "2026-10-10 13:00:00", is_estimated: 0 },
    { id: 12, prospect_id: 4, stage_key: "negotiation", entered_at: "2026-10-10 14:00:00", is_estimated: 0 },
    { id: 13, prospect_id: 4, stage_key: "proposal_scheduled", entered_at: "2026-10-10 15:00:00", is_estimated: 0 },
    { id: 14, prospect_id: 4, stage_key: "closed", entered_at: "2026-10-10 16:00:00", is_estimated: 1 },
    { id: 15, prospect_id: 5, stage_key: "contacted", entered_at: "2026-10-15 12:00:00", is_estimated: 0 },
    { id: 16, prospect_id: 5, stage_key: "new", entered_at: "2026-10-16 12:00:00", is_estimated: 0 },
    { id: 17, prospect_id: 5, stage_key: "responded", entered_at: "2026-10-16 13:00:00", is_estimated: 0 },
    { id: 18, prospect_id: 5, stage_key: "contacted", entered_at: "2026-10-16 14:00:00", is_estimated: 0 },
  ], range);

  assert.deepEqual(counts, {
    newStage: 4,
    contacted: 2,
    responded: 1,
    triage: 0,
    proposalScheduled: 1,
    proposals: 2,
    negotiations: 2,
    closed: 1,
  });
});
