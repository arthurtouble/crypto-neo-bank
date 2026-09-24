import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const [claims, prohibited, content] = await Promise.all([readJson("marketing/approved-claims.json"), readJson("marketing/prohibited-claims.json"), readJson("marketing/content-register.json")]);
const byId = new Map(claims.map((claim) => [claim.id, claim]));
const errors = []; const warnings = []; const now = Date.now();

for (const item of content) {
  if (!item.owner || !item.audience || !Array.isArray(item.countries) || !item.disclosure || !item.reviewStatus || !item.reviewAt) errors.push(`${item.id}: incomplete content registration`);
  if (item.reviewStatus !== "approved") errors.push(`${item.id}: content review is ${item.reviewStatus}`);
  const source = await readFile(resolve(root, item.file), "utf8").catch(() => null);
  if (source === null) { errors.push(`${item.id}: registered file is missing`); continue; }
  const lower = source.toLowerCase();
  for (const phrase of prohibited) if (lower.includes(String(phrase).toLowerCase())) errors.push(`${item.id}: prohibited phrase “${phrase}”`);
  for (const claimId of item.claimIds ?? []) {
    const claim = byId.get(claimId);
    if (!claim) { errors.push(`${item.id}: unknown claim ${claimId}`); continue; }
    if (claim.status !== "approved") errors.push(`${claimId}: status is ${claim.status}`);
    if (!claim.approvedBy || !claim.approvedAt) errors.push(`${claimId}: approval evidence is incomplete`);
    if (!claim.reviewAt || Date.parse(claim.reviewAt) <= now) errors.push(`${claimId}: review is expired`);
    if (!source.includes(claim.copy)) errors.push(`${item.id}: registered claim copy is absent: ${claim.copy}`);
    if (claim.requiredDisclosure && !item.disclosure) errors.push(`${item.id}: required disclosure is missing`);
  }
  warnings.push(`${item.id}: semantic variants still require human review`);
}

for (const warning of warnings) console.warn(`MARKETING REVIEW: ${warning}`);
if (errors.length) { for (const error of errors) console.error(`MARKETING ERROR: ${error}`); process.exitCode = 1; }
else console.log(`Marketing claims check passed for ${content.length} registered content assets.`);
