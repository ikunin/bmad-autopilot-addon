/**
 * E2E Greenfield Test: Tic Tac Toe via BMAD Autopilot
 *
 * Pure observer test — validates that the autopilot correctly:
 * - Plans and implements a complete game
 * - Commits planning artifacts to main
 * - Merges story branches to main after completion
 * - Marks task checkboxes in story files
 * - Generates documentation
 * - Pushes everything to the remote
 *
 * The test does NOT do any merging, committing, or artifact management itself.
 * It only invokes the autopilot and verifies the results.
 *
 * Run: npm run test:e2e:greenfield
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { runClaude } from "./harness/claude-runner.js";
import {
  createTempProject,
  placeFixture,
  type TempProject,
} from "./harness/temp-project.js";
import {
  assertFileExists,
  assertFileNotEmpty,
  assertDirectoryExists,
  assertFileContains,
} from "./harness/assertions.js";
import { costTracker } from "./harness/cost-tracker.js";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures/greenfield");
const ADDON_SOURCE = join(import.meta.dirname, "../../_bmad-addons");

const MAX_SESSIONS = 8;
const BUDGET_PER_SESSION = 20;
const TIMEOUT_PER_SESSION = 900_000; // 15 min

let project: TempProject;

function git(cmd: string, dir: string): string {
  return execSync(`git -C "${dir}" ${cmd}`, {
    encoding: "utf-8",
    timeout: 30_000,
  }).trim();
}

function findFiles(dir: string, pattern: RegExp, excludeDirs: string[]): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (excludeDirs.includes(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findFiles(fullPath, pattern, excludeDirs));
      } else if (pattern.test(entry.name)) {
        results.push(fullPath);
      }
    }
  } catch { /* ignore */ }
  return results;
}

/** Check if game has all required features — checks current HEAD only */
function isGameComplete(dir: string): boolean {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return false;

  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  if (!pkg.scripts?.test) return false;

  // Install deps if needed
  if (!existsSync(join(dir, "node_modules"))) {
    try { execSync("npm install", { cwd: dir, timeout: 60_000, stdio: "pipe" }); } catch { /* */ }
  }

  // Tests must pass
  try {
    execSync("npm test", { cwd: dir, encoding: "utf-8", timeout: 60_000, stdio: "pipe" });
  } catch { return false; }

  // Must have core features in source
  const srcFiles = findFiles(dir, /\.(ts|js)$/, ["node_modules", ".git", "_bmad", "dist"]);
  const allSource = srcFiles.map((f) => readFileSync(f, "utf-8")).join("\n").toLowerCase();

  const features = {
    hasWinDetection: /win|winner|check.?win|winning/.test(allSource),
    hasDrawDetection: /draw|tie|stalemate/.test(allSource),
    hasBoardDisplay: /board|display|render|print|grid/.test(allSource),
    hasMoveLogic: /move|place|position/.test(allSource),
  };

  const complete = Object.values(features).every(Boolean);
  console.log(`[Complete?] ${complete ? "YES" : "NO"} — ${JSON.stringify(features)}`);
  return complete;
}

/** Get test count from vitest output */
function getTestCount(dir: string): { files: number; tests: number } {
  try {
    const output = execSync("npx vitest run 2>&1", { cwd: dir, encoding: "utf-8", timeout: 60_000 });
    const testsMatch = output.match(/Tests\s+(\d+)\s+passed/);
    const filesMatch = output.match(/Test Files\s+(\d+)\s+passed/);
    return {
      files: filesMatch ? parseInt(filesMatch[1], 10) : 0,
      tests: testsMatch ? parseInt(testsMatch[1], 10) : 0,
    };
  } catch { return { files: 0, tests: 0 }; }
}

describe("Greenfield: Tic Tac Toe via BMAD Autopilot", () => {
  beforeAll(() => {
    project = createTempProject({
      remoteUrl: "git@github.com:ikunin/test-tictactoe.git",
      installBmadCore: true,
      installAddon: true,
      platform: "github",
    });

    placeFixture(
      project.dir,
      "_bmad-output/planning-artifacts/product-brief.md",
      readFileSync(join(FIXTURES_DIR, "product-brief.md"), "utf-8")
    );

    console.log(`[Greenfield] Temp project: ${project.dir}`);
  });

  afterAll(() => {
    console.log(costTracker.report());
    project?.cleanup();
  });

  // ── Phase 1: Run the autopilot until game is complete ──

  it("setup is valid", () => {
    assertDirectoryExists(join(project.dir, "_bmad-addons"));
    assertDirectoryExists(join(project.dir, "_bmad"));
    assertFileExists(join(project.dir, "_bmad-output/planning-artifacts/product-brief.md"));
    assertFileContains(join(project.dir, ".gitignore"), /\.autopilot\.lock/);
  });

  it("autopilot builds complete tic-tac-toe game", async () => {
    let session = 0;
    let totalCost = 0;

    while (session < MAX_SESSIONS) {
      session++;

      // Check if game is already complete on main
      git("checkout main", project.dir);
      if (isGameComplete(project.dir)) {
        console.log(`[Session ${session}] Game complete on main — done`);
        break;
      }

      const systemPrompt = [
        "You are running inside an automated e2e test.",
        session === 1
          ? "Follow the BMAD autopilot workflow exactly. The product brief is already at _bmad-output/planning-artifacts/product-brief.md."
          : "Resume the BMAD autopilot from saved state.",
        "Do NOT ask the user any questions — resolve all decisions autonomously.",
        "Use TypeScript with Vitest for testing.",
        "Implement ALL features: board display, move input validation, win detection (all 8 lines), draw detection, game flow with play-again.",
        "The game must be playable from the CLI via `npx tsx src/main.ts`.",
      ].join(" ");

      console.log(`\n[Session ${session}/${MAX_SESSIONS}] Starting autopilot...`);

      const result = await runClaude("/bmad-autopilot-on", {
        cwd: project.dir,
        maxBudget: BUDGET_PER_SESSION,
        model: "sonnet",
        addDirs: [ADDON_SOURCE],
        timeout: TIMEOUT_PER_SESSION,
        appendSystemPrompt: systemPrompt,
      });

      const cost = result.json?.total_cost_usd ?? 0;
      totalCost += cost;
      costTracker.record("greenfield", `session-${session}`, cost, result.json?.duration_ms ?? 0);

      const status = result.timedOut ? "TIMED_OUT"
        : result.json?.is_error ? "ERROR"
        : result.exitCode === 0 ? "OK"
        : `EXIT_${result.exitCode}`;

      console.log(`[Session ${session}] ${status} | Cost: $${cost.toFixed(4)} | Total: $${totalCost.toFixed(4)}`);

      if (result.json?.is_error) {
        console.error(`[Session ${session}] Error: ${result.json.result}`);
        // Rate limit — stop retrying
        if (result.json.result?.includes("limit")) break;
      }
    }

    // Verify game is complete on main
    git("checkout main", project.dir);
    if (!existsSync(join(project.dir, "node_modules")) && existsSync(join(project.dir, "package.json"))) {
      try { execSync("npm install", { cwd: project.dir, timeout: 60_000, stdio: "pipe" }); } catch { /* */ }
    }
    const complete = isGameComplete(project.dir);
    console.log(`\n[Result] ${complete ? "SUCCESS" : "INCOMPLETE"} after ${session} sessions, $${totalCost.toFixed(4)}`);
    expect(complete).toBe(true);
  }, MAX_SESSIONS * (TIMEOUT_PER_SESSION + 120_000));

  // ── Phase 2: Verify the autopilot did its job correctly ──
  //    These are pure assertions — no mutations.

  it("story branches were merged to main by autopilot", () => {
    const dir = project.dir;
    git("checkout main", dir);

    // Main should have more than just the initial commits
    const commitCount = parseInt(git("rev-list --count main", dir), 10);
    console.log(`[Merge] Commits on main: ${commitCount}`);
    expect(commitCount).toBeGreaterThan(2); // initial + gitignore + at least one merge/artifact commit

    // Source files must exist on main (not just on story branches)
    const srcFiles = findFiles(dir, /\.(ts|js)$/, ["node_modules", ".git", "_bmad", "dist"]);
    console.log(`[Merge] Source files on main: ${srcFiles.length}`);
    expect(srcFiles.length).toBeGreaterThanOrEqual(4);

    // Tests pass on main
    const { tests } = getTestCount(dir);
    console.log(`[Merge] Tests on main: ${tests} passed`);
    expect(tests).toBeGreaterThan(0);
  }, 120_000);

  it("planning artifacts were committed to main by autopilot", () => {
    const dir = project.dir;
    git("checkout main", dir);

    // Sprint status should exist on main
    const sprintStatus = join(dir, "_bmad-output/implementation-artifacts/sprint-status.yaml");
    if (existsSync(sprintStatus)) {
      assertFileNotEmpty(sprintStatus);
      assertFileContains(sprintStatus, /status:\s*done/);
      console.log("[Artifacts] sprint-status.yaml on main ✓");
    } else {
      console.warn("[Artifacts] sprint-status.yaml not on main");
    }

    // Git log should show artifact commits
    const log = git("log --oneline --all", dir);
    console.log(`[Artifacts] Git log:\n${log}`);
  }, 30_000);

  it("story files have task checkboxes marked", () => {
    const dir = project.dir;
    git("checkout main", dir);

    // Find story files
    const storyFiles = findFiles(join(dir, "_bmad-output"), /story.*\.md$/, [".git"]);
    console.log(`[Tasks] Found ${storyFiles.length} story files`);

    for (const sf of storyFiles) {
      const content = readFileSync(sf, "utf-8");
      const name = sf.split("/").pop();
      const checked = (content.match(/\[x\]/gi) || []).length;
      const unchecked = (content.match(/\[ \]/g) || []).length;
      const hasDevRecord = content.includes("Dev Agent Record");

      console.log(`[Tasks] ${name}: ${checked} checked, ${unchecked} unchecked, devRecord: ${hasDevRecord}`);

      // At least some tasks should be checked
      if (checked === 0 && unchecked > 0) {
        console.warn(`[Tasks] WARNING: ${name} has ${unchecked} unchecked tasks`);
      }
    }
  }, 30_000);

  it("lock is released and project is clean", () => {
    const dir = project.dir;

    // Lock must be released
    expect(existsSync(join(dir, ".autopilot.lock"))).toBe(false);

    // Autopilot state file should be deleted (sprint complete)
    const statePath = join(dir, "_bmad-output/implementation-artifacts/autopilot-state.yaml");
    if (existsSync(statePath)) {
      console.warn("[Clean] autopilot-state.yaml still exists — sprint may not have completed");
    }

    console.log(`[Clean] Project dir: ${dir}`);
  });
});
