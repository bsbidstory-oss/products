/**
 * @file backup.js
 * @description Firestore database backup utility for Products project.
 * Fetches all collections and saves them locally as JSON files.
 *
 * Usage:
 *   npm run db:backup
 *
 * Output:
 *   local_db/<collection>.json        — flattened human-readable records
 *   local_db/<collection>.raw.json    — raw Firestore REST format
 *   local_db/_backup_meta.json        — backup summary with stats and timestamps
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Configuration ──────────────────────────────────────────────────────────
const API_KEY    = "AIzaSyDvT5RWHn2VStZ8Iy5Abxx7ciztdDLvBDw";
const PROJECT_ID = "products-ecbb1";
const AUTH_URL   = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`;
const BASE_URL   = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const OUTPUT_DIR = path.join(__dirname, "local_db");
const PAGE_SIZE  = 300;
const MAX_RETRIES = 3;

const COLLECTIONS = [
  "marketplace_products",
  "product_ratings_v2",
];

// ─── Console helpers ─────────────────────────────────────────────────────────
const c = {
  reset:  "\x1b[0m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  red:    "\x1b[31m",
  cyan:   "\x1b[36m",
  gray:   "\x1b[90m",
  bold:   "\x1b[1m",
};
const log  = (msg) => console.log(msg);
const info = (msg) => console.log(`${c.cyan}ℹ${c.reset}  ${msg}`);
const ok   = (msg) => console.log(`${c.green}✔${c.reset}  ${msg}`);
const warn = (msg) => console.warn(`${c.yellow}⚠${c.reset}  ${msg}`);
const err  = (msg) => console.error(`${c.red}✖${c.reset}  ${msg}`);

// ─── Firestore value decoder ─────────────────────────────────────────────────
function flattenValue(valueObj) {
  if (!valueObj) return null;

  const primitives = [
    "stringValue", "integerValue", "doubleValue",
    "booleanValue", "timestampValue", "bytesValue",
    "referenceValue",
  ];

  for (const type of primitives) {
    if (type in valueObj) {
      const val = valueObj[type];
      if (type === "integerValue" || type === "doubleValue") return Number(val);
      return val;
    }
  }
  if ("nullValue" in valueObj) return null;
  if ("geoPointValue" in valueObj) {
    const gp = valueObj.geoPointValue;
    return { lat: gp.latitude || 0, lng: gp.longitude || 0 };
  }
  if ("arrayValue" in valueObj) {
    return (valueObj.arrayValue.values || []).map(flattenValue);
  }
  if ("mapValue" in valueObj) {
    const out = {};
    for (const [k, v] of Object.entries(valueObj.mapValue.fields || {})) {
      out[k] = flattenValue(v);
    }
    return out;
  }
  return valueObj;
}

function flattenDocument(doc) {
  if (!doc || !doc.name) return null;
  const parts    = doc.name.split("/");
  const docId    = parts[parts.length - 1];
  const fields   = doc.fields || {};
  const result   = { _docId: docId };
  for (const [key, val] of Object.entries(fields)) {
    result[key] = flattenValue(val);
  }
  return result;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function getAuthToken() {
  info("Authenticating anonymously with Firebase Auth...");
  const res = await fetch(AUTH_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ returnSecureToken: true }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Auth failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  ok("Authentication successful.");
  return data.idToken;
}

// ─── Fetch with retry ────────────────────────────────────────────────────────
async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        const text = await res.text();
        if (res.status === 429 && attempt < retries) {
          const delay = attempt * 2000;
          warn(`Rate limited (429). Retrying in ${delay / 1000}s... (attempt ${attempt}/${retries})`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      return res.json();
    } catch (e) {
      if (attempt === retries) throw e;
      const delay = attempt * 1500;
      warn(`Request failed. Retrying in ${delay / 1000}s... (attempt ${attempt}/${retries}): ${e.message}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// ─── Fetch collection with pagination ─────────────────────────────────────────
async function fetchCollection(collectionName, token) {
  const documents = [];
  let pageToken   = "";
  let page        = 1;

  do {
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    if (pageToken) params.set("pageToken", pageToken);

    const url     = `${BASE_URL}/${collectionName}?${params}`;
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const data    = await fetchWithRetry(url, { headers });

    const batch = data.documents || [];
    documents.push(...batch);
    pageToken = data.nextPageToken || "";

    process.stdout.write(`\r   ${c.gray}Page ${page}: ${documents.length} documents loaded...${c.reset}`);
    page++;
  } while (pageToken);

  process.stdout.write("\n");
  return documents;
}

// ─── Save collection ──────────────────────────────────────────────────────────
function saveCollection(collectionName, rawDocs) {
  const flat    = rawDocs.map(flattenDocument).filter(Boolean);
  const rawPath = path.join(OUTPUT_DIR, `${collectionName}.raw.json`);
  const flatPath = path.join(OUTPUT_DIR, `${collectionName}.json`);

  fs.writeFileSync(rawPath, JSON.stringify(rawDocs, null, 2), "utf8");
  fs.writeFileSync(flatPath, JSON.stringify(flat,    null, 2), "utf8");

  return { count: rawDocs.length, flatCount: flat.length };
}

// ─── Diff summary (compare to previous backup) ───────────────────────────────
function diffWithPrevious(collectionName, currentCount) {
  const flatPath = path.join(OUTPUT_DIR, `${collectionName}.json`);
  if (!fs.existsSync(flatPath)) return null;
  try {
    const prev = JSON.parse(fs.readFileSync(flatPath, "utf8"));
    return currentCount - (Array.isArray(prev) ? prev.length : 0);
  } catch (_) {
    return null;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function runBackup() {
  const startTime = Date.now();
  log("");
  log(`${c.bold}${c.cyan}═══════════════════════════════════════${c.reset}`);
  log(`${c.bold}  Firestore Backup — Project: ${PROJECT_ID}${c.reset}`);
  log(`${c.bold}${c.cyan}═══════════════════════════════════════${c.reset}`);
  log(`  Started: ${new Date().toLocaleString()}`);
  log("");

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    ok(`Created output directory: ${OUTPUT_DIR}`);
  }

  // Authenticate
  let token = null;
  try {
    token = await getAuthToken();
  } catch (authErr) {
    warn(`Anonymous auth failed — proceeding without auth token. Some collections may be inaccessible.`);
    warn(`Reason: ${authErr.message}`);
  }

  log("");
  info(`Backing up ${COLLECTIONS.length} collections to: ${OUTPUT_DIR}`);
  log("");

  const meta = {
    project_id:  PROJECT_ID,
    backup_time: new Date().toISOString(),
    collections: {},
    total_docs:  0,
    errors:      [],
  };

  for (const collection of COLLECTIONS) {
    const collStart = Date.now();
    const prevDiff  = diffWithPrevious(collection, 0); // read old count before overwrite

    process.stdout.write(`  ${c.bold}${collection}${c.reset} — fetching...`);
    process.stdout.write("\n");

    try {
      const rawDocs = await fetchCollection(collection, token);
      const diff    = diffWithPrevious(collection, rawDocs.length);
      const { count } = saveCollection(collection, rawDocs);
      const elapsed   = ((Date.now() - collStart) / 1000).toFixed(1);

      let diffLabel = "";
      if (diff !== null) {
        diffLabel = diff > 0 ? `${c.green}(+${diff} new)${c.reset}` :
                    diff < 0 ? `${c.red}(${diff} removed)${c.reset}` :
                    `${c.gray}(no change)${c.reset}`;
      }

      ok(`${c.bold}${collection}${c.reset}: ${count} docs in ${elapsed}s ${diffLabel}`);

      meta.collections[collection] = { count, elapsed_sec: parseFloat(elapsed) };
      meta.total_docs += count;

    } catch (fetchErr) {
      err(`${collection}: ${fetchErr.message}`);
      meta.errors.push({ collection, error: fetchErr.message });
    }
  }

  // Save metadata
  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  meta.total_elapsed_sec = parseFloat(totalElapsed);

  const metaPath = path.join(OUTPUT_DIR, "_backup_meta.json");
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");

  log("");
  log(`${c.bold}${c.cyan}═══════════════════════════════════════${c.reset}`);
  ok(`${c.bold}Backup complete!${c.reset}`);
  log(`   Total documents : ${c.bold}${meta.total_docs}${c.reset}`);
  log(`   Total time      : ${c.bold}${totalElapsed}s${c.reset}`);
  log(`   Output folder   : ${c.gray}${OUTPUT_DIR}${c.reset}`);
  log(`   Meta file       : ${c.gray}${metaPath}${c.reset}`);
  if (meta.errors.length > 0) {
    warn(`${meta.errors.length} collection(s) had errors: ${meta.errors.map((e) => e.collection).join(", ")}`);
  }
  log(`${c.bold}${c.cyan}═══════════════════════════════════════${c.reset}`);
  log("");
}

runBackup().catch((fatal) => {
  err(`Critical backup failure: ${fatal.message}`);
  process.exit(1);
});
