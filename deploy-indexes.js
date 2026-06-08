/**
 * @file deploy-indexes.js
 * @description سكريبت نشر الفهارس إلى Firestore عبر Firebase CLI
 *
 * الاستخدام:
 *   npm run indexes:deploy        ← ينشر الفهارس عبر Firebase CLI
 *   npm run indexes:list          ← يعرض الفهارس الحالية من Firestore
 *   npm run firebase:login        ← تسجيل الدخول (مطلوب قبل النشر الأول)
 */

"use strict";

const { execSync, spawnSync } = require("child_process");
const path = require("path");
const fs   = require("fs");

const PROJECT_ID = "products-ecbb1";
const ROOT = __dirname;

const RESET  = "\x1b[0m";
const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED    = "\x1b[31m";
const CYAN   = "\x1b[36m";
const BOLD   = "\x1b[1m";
const DIM    = "\x1b[2m";

function log(msg, color = RESET) { console.log(`${color}${msg}${RESET}`); }
function ok(msg)   { log(`  ✔  ${msg}`, GREEN); }
function warn(msg) { log(`  ⚠  ${msg}`, YELLOW); }
function err(msg)  { log(`  ✖  ${msg}`, RED); }
function info(msg) { log(`  ℹ  ${msg}`, CYAN); }
function title(msg){ log(`\n${BOLD}${msg}${RESET}`); }

function runFirebase(args) {
  // يبحث عن firebase-tools في npm global أو node_modules
  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["firebase-tools", ...args],
    { cwd: ROOT, stdio: "pipe", encoding: "utf8" }
  );
  return {
    ok:     result.status === 0,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status,
  };
}

// ==========================================
// وضع العرض: عرض الفهارس الحالية
// ==========================================
function cmdList() {
  title("═══════════════════════════════════════");
  log(`  عرض فهارس Firestore — ${PROJECT_ID}`, BOLD);
  title("═══════════════════════════════════════");

  info("جاري الاستعلام عن الفهارس الحالية...\n");

  const r = runFirebase(["firestore:indexes", "--project", PROJECT_ID]);

  if (!r.ok) {
    if (r.stderr.includes("401") || r.stderr.includes("authentication") || r.stderr.includes("not logged")) {
      err("يجب تسجيل الدخول أولاً:");
      warn("شغّل: npm run firebase:login");
    } else {
      err("فشل الاستعلام:\n" + r.stderr);
    }
    process.exit(1);
  }

  // firebase-tools ترجع الفهارس بصيغة JSON أو نص
  try {
    const indexes = JSON.parse(r.stdout);
    if (!indexes?.indexes?.length) {
      warn("لا توجد فهارس مُعرَّفة حالياً.");
      return;
    }
    log(`\n  وُجد ${indexes.indexes.length} فهرس:\n`, DIM);
    indexes.indexes.forEach((idx, i) => {
      const state  = idx.state === "READY" ? `${GREEN}READY${RESET}` : `${YELLOW}${idx.state || "BUILDING"}${RESET}`;
      const fields = (idx.fields || []).map(f => `${f.fieldPath} ${f.order}`).join(", ");
      log(`  ${DIM}[${i + 1}]${RESET} ${idx.queryScope} | ${idx.collectionGroup || "?"} | ${fields} | ${state}`);
    });
  } catch {
    // طباعة الناتج الخام إذا لم يكن JSON
    log(r.stdout);
  }
}

// ==========================================
// وضع النشر: نشر الفهارس عبر Firebase CLI
// ==========================================
function cmdDeploy() {
  title("═══════════════════════════════════════");
  log(`  نشر فهارس Firestore — ${PROJECT_ID}`, BOLD);
  title("═══════════════════════════════════════");

  // تحقق من وجود firestore.indexes.json
  const indexFile = path.join(ROOT, "firestore.indexes.json");
  if (!fs.existsSync(indexFile)) {
    err("ملف firestore.indexes.json غير موجود!");
    process.exit(1);
  }
  ok(`ملف الفهارس موجود: ${path.basename(indexFile)}`);

  // تحقق من وجود firebase.json
  const fbFile = path.join(ROOT, "firebase.json");
  if (!fs.existsSync(fbFile)) {
    err("ملف firebase.json غير موجود!");
    process.exit(1);
  }
  ok(`ملف الإعداد موجود: ${path.basename(fbFile)}`);

  info("\nجاري نشر الفهارس عبر Firebase CLI...\n");

  const r = runFirebase(["deploy", "--only", "firestore:indexes", "--project", PROJECT_ID]);

  // طباعة الناتج
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr && !r.ok) process.stderr.write(r.stderr);

  if (!r.ok) {
    log("");
    if (r.stderr.includes("401") || r.stderr.includes("authentication") || r.stderr.includes("not logged") || r.stderr.includes("UNAUTHENTICATED")) {
      err("Token منتهي الصلاحية — يجب إعادة تسجيل الدخول:");
      warn("\n  شغّل:  npm run firebase:login  ثم أعد التشغيل\n");
    } else if (r.stderr.includes("PERMISSION_DENIED")) {
      err("لا توجد صلاحية على مشروع products-ecbb1.");
      warn("تأكد أن الحساب المسجَّل له صلاحية على هذا المشروع.");
      warn("  شغّل:  npm run firebase:login\n");
    } else {
      err("فشل النشر. راجع firebase-debug.log للتفاصيل.");
    }
    process.exit(1);
  }

  log("");
  ok("تم نشر الفهارس بنجاح!");
  info("قد تستغرق بعض الفهارس 1-5 دقائق للبناء.");
  info(`راقب الحالة: npm run indexes:list`);
  info(`أو من Firebase Console:`);
  log(`  https://console.firebase.google.com/project/${PROJECT_ID}/firestore/indexes\n`, DIM);
}

// ==========================================
// نقطة الدخول
// ==========================================
const args = process.argv.slice(2);
if (args.includes("--list")) {
  cmdList();
} else {
  cmdDeploy();
}
