import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import moment from "moment";

const START_DATE = moment("2025-11-27T00:00:00+03:00");
const END_DATE = moment("2026-08-06T23:59:59+03:00");
const MIN_PER_DAY = 25;
const MAX_PER_DAY = 39;
const WEEKEND_MIN = 18;
const WEEKEND_MAX = 32;
const REST_CHANCE = 0.08;
const TZ_OFFSET = 3 * 60;
const TZ = "+0300";
const AUTHOR_NAME = "atilioobadia-cpu";
const AUTHOR_EMAIL = "atilioobadia@gmail.com";
const LOG_FILE = "activity.log";

const PROJECT_FILES = [
  ".gitignore",
  "README.md",
  "index.js",
  "package.json",
  "package-lock.json",
  "data.json",
];

const VERBS = [
  "add", "update", "fix", "refactor", "improve", "adjust",
  "implement", "extend", "revise", "clean up", "optimize", "tune",
];
const NOUNS = [
  "sales invoice flow", "checkout total calculation", "customer profile layout",
  "POS cart handling", "dashboard metric", "report query filter",
  "API response serializer", "UI form validation", "error handling path",
  "data migration script", "print format template", "role permission rule",
  "notification settings", "search index mapping", "background sync job",
  "cache layer logic", "pagination query", "webhook endpoint",
  "workflow approval step", "field label wording",
];

const runGit = (args, options = {}) =>
  execFileSync("git", args, {
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf8",
    cwd: process.cwd(),
    ...options,
  });

const mulberry32 = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

const buildPlan = () => {
  const dates = [];
  let cursor = START_DATE.clone().startOf("day");
  while (cursor.isSameOrBefore(END_DATE, "day")) {
    dates.push(cursor.clone());
    cursor.add(1, "day");
  }

  const now = moment();
  return dates.map((date) => {
    const rng = mulberry32(date.unix() + 42);
    const isWeekend = date.day() === 0 || date.day() === 6;
    const isRest = rng() < REST_CHANCE;

    let count;
    if (isRest) {
      count = Math.floor(rng() * 5);
    } else if (isWeekend) {
      count = WEEKEND_MIN + Math.floor(rng() * (WEEKEND_MAX - WEEKEND_MIN + 1));
    } else {
      count = MIN_PER_DAY + Math.floor(rng() * (MAX_PER_DAY - MIN_PER_DAY + 1));
    }

    const pool = [];
    for (let m = 450; m <= 1439; m += 1) pool.push(m);
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    let minutes = pool.slice(0, count).sort((a, b) => a - b);
    if (date.isSame(now, "day")) {
      const nowMinute = now.hours() * 60 + now.minutes();
      minutes = minutes.filter((m) => m <= nowMinute);
    }

    const times = minutes.map((m) => moment.unix(date.unix() + m * 60).utcOffset(TZ_OFFSET));
    return { date, count: times.length, times };
  });
};

const makeMessage = (rng, used) => {
  if (used.size > 300) used.clear();
  for (;;) {
    const verb = pick(rng, VERBS);
    const noun = pick(rng, NOUNS);
    const roll = rng();
    const prefix = roll < 0.12 ? "feat:" : roll < 0.24 ? "chore:" : roll < 0.33 ? "docs:" : roll < 0.4 ? "test:" : "";
    const msg = `${prefix ? `${prefix} ` : ""}${verb} ${noun}`;
    if (!used.has(msg)) {
      used.add(msg);
      return msg;
    }
  }
};

const buildStream = (plan) => {
  const lines = [];
  const msgRng = mulberry32(777);
  const used = new Set();
  let blobMark = 1;
  let commitMark = 100000;
  let prevMark = null;
  let firstCommit = true;
  let logLine = "";
  let total = 0;

  const pushBlob = (content) => {
    lines.push("blob");
    lines.push(`mark :${blobMark}`);
    lines.push(`data ${Buffer.byteLength(content, "utf8")}`);
    lines.push(content);
    const mark = blobMark;
    blobMark += 1;
    return mark;
  };

  const fileMarks = PROJECT_FILES.map((file) => {
    const raw = existsSync(file) ? readFileSync(file, "utf8") : "";
    const content = raw === "" ? "" : raw.endsWith("\n") ? raw : `${raw}\n`;
    return { file, mark: pushBlob(content) };
  });

  for (const day of plan) {
    for (const time of day.times) {
      const message = makeMessage(msgRng, used);
      const epoch = time.unix();
      const wall = time.format("YYYY-MM-DDTHH:mm:ss");

      if (!firstCommit) {
        logLine = `${wall} ${TZ} | ${message}`;
      }

      const logMark = pushBlob(`${logLine}\n`);

      lines.push("commit refs/heads/main");
      lines.push(`mark :${commitMark}`);
      lines.push(`author ${AUTHOR_NAME} <${AUTHOR_EMAIL}> ${epoch} ${TZ}`);
      lines.push(`committer ${AUTHOR_NAME} <${AUTHOR_EMAIL}> ${epoch} ${TZ}`);
      lines.push(`data ${Buffer.byteLength(message, "utf8")}`);
      lines.push(message);
      if (prevMark) lines.push(`from :${prevMark}`);
      if (firstCommit) {
        for (const { file, mark } of fileMarks) lines.push(`M 100644 :${mark} ${file}`);
        firstCommit = false;
      } else {
        lines.push(`M 100644 :${logMark} ${LOG_FILE}`);
      }
      prevMark = commitMark;
      commitMark += 1;
      total += 1;
    }
  }

  return { stream: `${lines.join("\n")}\n`, total };
};

const run = () => {
  try {
    runGit(["rev-parse", "--is-inside-work-tree"]);
  } catch {
    runGit(["init", "--initial-branch=main"]);
  }

  const plan = buildPlan();
  const { stream, total } = buildStream(plan);
  writeFileSync(".git-import-stream", stream, "utf8");
  runGit(["fast-import", "--force"], { input: stream });

  const count = runGit(["rev-list", "--count", "HEAD"]).trim();
  const first = runGit(["log", "-1", "--format=%ad", "--date=short", "--reverse"]).trim();
  const last = runGit(["log", "-1", "--format=%ad", "--date=short"]).trim();
  console.log(`Imported ${total} commits across ${plan.length} days.`);
  console.log(`Branch count: ${count} | range: ${first} -> ${last}`);
};

try {
  run();
} catch (err) {
  console.error("Run failed:", err);
  process.exit(1);
}
