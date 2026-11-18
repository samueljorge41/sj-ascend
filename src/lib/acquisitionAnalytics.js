import { acquisitionBusinessDate } from "./acquisitionDate.js";

const FUNNEL_STAGES = [
  ["new", "newStage"],
  ["contacted", "contacted"],
  ["responded", "responded"],
  ["triage_scheduled", "triage"],
  ["proposal_scheduled", "proposalScheduled"],
  ["proposal_sent", "proposals"],
  ["negotiation", "negotiations"],
  ["closed", "closed"],
];

export function getAcquisitionFunnelCounts(events, range) {
  const eventsByProspect = new Map();
  const cohortEntries = new Map();

  for (const event of events) {
    if (event.is_estimated) continue;
    const date = acquisitionBusinessDate(event.entered_at);
    if (!date) continue;

    if (!eventsByProspect.has(event.prospect_id)) eventsByProspect.set(event.prospect_id, []);
    eventsByProspect.get(event.prospect_id).push({ ...event, businessDate: date });

    if (event.stage_key !== "new" || date < range.start || date > range.end) continue;
    const currentEntry = cohortEntries.get(event.prospect_id);
    if (!currentEntry || date < currentEntry.businessDate || (date === currentEntry.businessDate && event.id < currentEntry.id)) {
      cohortEntries.set(event.prospect_id, { ...event, businessDate: date });
    }
  }

  const counts = Object.fromEntries(FUNNEL_STAGES.map(([, key]) => [key, 0]));
  for (const [prospectId, entry] of cohortEntries) {
    const reachedStages = new Set(["new"]);
    for (const event of eventsByProspect.get(prospectId) || []) {
      if (event.businessDate < entry.businessDate || (event.businessDate === entry.businessDate && event.id < entry.id)) continue;
      if (FUNNEL_STAGES.some(([stage]) => stage === event.stage_key)) reachedStages.add(event.stage_key);
    }
    for (const [stage, key] of FUNNEL_STAGES) {
      if (reachedStages.has(stage)) counts[key] += 1;
    }
  }

  return counts;
}
