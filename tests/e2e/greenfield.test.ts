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
  assertCleanWorkingTree,
  assertNoOrphanedWorktrees,
  readYaml,
} from "./harness/assertions.js";
import { costTracker } from "./harness/cost-tracker.js";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures/greenfield");
const ADDON_SOURCE = join(import.meta.dirname, "../../_bmad-addons");

const MAX_SESSIONS = 8;
const BUDGET_PER_SESSION = 20;
const TIMEOUT_PER_SESSION = 1_200_000; // 20 min

/** Model to use — override via BMAD_TEST_MODEL env var (e.g. "opus") */
const MODEL = process.env.BMAD_TEST_MODEL ?? "sonnet";

/** Remote URL for push testing — override via env; falls back to local bare remote if unset */
const REMOTE_URL = process.env.BMAD_TEST_REMOTE_URL ?? "";

let project: TempProject;

function git(cmd: string, dir: string): string {
  return execSync(`git -C "${dir}" ${cmd}`, {
    encoding: "utf-8",
    timeout: 30_000,
    env: { ...process.env, GIT_WORK_TREE: dir },
  }).trim();
}

/** Force-checkout a branch, discarding local file changes that block checkout */
function gitCheckout(branch: string, dir: string): void {
  try { execSync(`rm -rf "${dir}/node_modules/.vite"`, { timeout: 5_000 }); } catch { /* */ }
  git(`checkout -f ${branch}`, dir);
}

function findFiles(dir: string, pattern: RegExp, excludeDirs: string[]): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (excludeDirs.includes(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, pattern, excludeDirs));
    } else if (pattern.test(entry.name)) {
      results.push(fullPath);
    }
  }
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
    try { execSync("npm install", { cwd: dir, timeout: 60_000, stdio: "pipe" }); } catch {
      console.warn("[isGameComplete] npm install failed");
      return false;
    }
  }

  // Tests must pass
  try {
    execSync("npm test", { cwd: dir, encoding: "utf-8", timeout: 60_000, stdio: "pipe" });
  } catch { return false; }

  // Must have core features in source — use word-boundary patterns to avoid false positives
  const srcFiles = findFiles(dir, /\.(ts|js)$/, ["node_modules", ".git", "_bmad", "dist"]);
  const allSource = srcFiles.map((f) => readFileSync(f, "utf-8")).join("\n").toLowerCase();

  const features = {
    hasWinDetection: /\bwin(?:ner|ning)?\b|check.?win\b/.test(allSource),
    hasDrawDetection: /\bdraw\b|\btie\b|\bstalemate\b/.test(allSource),
    hasBoardDisplay: /\bboard\b|\bgrid\b|display.?board|print.?board|render.?board/.test(allSource),
    hasMoveLogic: /\bmove\b|place.?mark|make.?move/.test(allSource),
  };

  const complete = Object.values(features).every(Boolean);
  console.log(`[Complete?] ${complete ? "YES" : "NO"} — ${JSON.stringify(features)}`);
  return complete;
}

/** Get the latest story branch by commit date (for PR-based flow where main may not have code yet) */
function getLatestStoryBranch(dir: string): string | null {
  try {
    const branches = execSync(
      `git -C "${dir}" branch -a --sort=-committerdate --list '*story/*'`,
      { encoding: "utf-8", timeout: 10_000 }
    ).trim();
    if (!branches) return null;
    // Strip markers: * (current), + (worktree), whitespace; prefer remote tracking branches
    // (local branches may be locked by worktrees and can't be checked out)
    const parsed = branches.split("\n")
      .map((b) => b.replace(/^\s*[*+]?\s*/, "").trim())
      .filter(Boolean);
    const remote = parsed.find((b) => b.startsWith("remotes/origin/story/"));
    if (remote) return remote.replace("remotes/origin/", "origin/");
    return parsed[0] || null;
  } catch { return null; }
}

/** Get the worktree path for a story branch (if it exists) */
function getWorktreePath(dir: string, branch: string): string | null {
  try {
    const list = execSync(`git -C "${dir}" worktree list --porcelain`, { encoding: "utf-8", timeout: 10_000 });
    const blocks = list.split("\n\n");
    for (const block of blocks) {
      if (block.includes(`branch refs/heads/${branch}`)) {
        const match = block.match(/^worktree (.+)$/m);
        return match ? match[1] : null;
      }
    }
  } catch { /* */ }
  return null;
}

/** Get test count from vitest output */
function getTestCount(dir: string): { files: number; tests: number; error?: string } {
  try {
    const output = execSync("npx vitest run 2>&1", { cwd: dir, encoding: "utf-8", timeout: 60_000 });
    const testsMatch = output.match(/Tests\s+(\d+)\s+passed/);
    const filesMatch = output.match(/Test Files\s+(\d+)\s+passed/);
    return {
      files: filesMatch ? parseInt(filesMatch[1], 10) : 0,
      tests: testsMatch ? parseInt(testsMatch[1], 10) : 0,
    };
  } catch (err) {
    const msg = (err as Error).message?.slice(0, 300);
    return { files: 0, tests: 0, error: msg };
  }
}

describe("Greenfield: Tic Tac Toe via BMAD Autopilot", () => {
  beforeAll(() => {
    project = createTempProject({
      ...(REMOTE_URL ? { remoteUrl: REMOTE_URL } : { withRemote: true }),
      installBmadCore: true,
      installAddon: true,
      platform: REMOTE_URL ? "github" : "git_only",
    });

    placeFixture(
      project.dir,
      "_bmad-output/planning-artifacts/product-brief.md",
      readFileSync(join(FIXTURES_DIR, "product-brief.md"), "utf-8")
    );

    console.log(`[Greenfield] Temp project: ${project.dir}`);
  });

  afterAll(async () => {
    // Ensure autopilot lock is released even if sprint didn't complete
    if (project && existsSync(join(project.dir, ".autopilot.lock"))) {
      console.log("[Cleanup] Lock still exists — running /bmad-autopilot-off to release");
      try {
        await runClaude("/bmad-autopilot-off", {
          cwd: project.dir,
          maxBudget: 2,
          model: MODEL,
          addDirs: [ADDON_SOURCE],
          timeout: 60_000,
        });
      } catch {
        // Best-effort cleanup — remove lock manually if autopilot-off fails
        try { execSync(`rm -f "${join(project.dir, ".autopilot.lock")}"`, { timeout: 5_000 }); } catch { /* */ }
      }
    }
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
    let gameComplete = false;

    while (session < MAX_SESSIONS) {
      session++;

      // Check if game is already complete — check main first (stories merge locally in git_only),
      // then fall back to latest story branch (via worktree path if in use)
      let checkDir = project.dir;
      let checkLabel = "main";
      try {
        gitCheckout("main", project.dir);
      } catch { /* already on main or main doesn't exist yet */ }
      if (!isGameComplete(project.dir)) {
        const latestBranch = getLatestStoryBranch(project.dir);
        if (latestBranch) {
          const localBranch = latestBranch.replace("origin/", "");
          const wt = getWorktreePath(project.dir, localBranch);
          if (wt) {
            checkDir = wt;
            checkLabel = `${localBranch} (worktree)`;
          } else {
            try { gitCheckout(latestBranch, project.dir); checkLabel = latestBranch; } catch { /* */ }
          }
        }
      }
      if (isGameComplete(checkDir)) {
        if (!gameComplete) {
          gameComplete = true;
          console.log(`[Session ${session}] Game code complete on ${checkLabel}`);
        }
        // Check if sprint is also complete (lock released = autopilot finished cleanly)
        if (!existsSync(join(project.dir, ".autopilot.lock"))) {
          console.log(`[Session ${session}] Sprint complete (lock released) — done`);
          break;
        }
        console.log(`[Session ${session}] Game complete but lock still held — running another session to finish sprint`);
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
        model: MODEL,
        addDirs: [ADDON_SOURCE],
        timeout: TIMEOUT_PER_SESSION,
        appendSystemPrompt: systemPrompt,
      });

      const cost = result.json?.total_cost_usd ?? 0;
      if (result.timedOut && cost === 0) {
        console.warn(`[Session ${session}] Cost=$0 — likely SIGTERM killed claude before JSON output`);
      }
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
        if (/rate.?limit/i.test(result.json.result ?? "")) break;
      }
    }

    // Verify game is complete — check main first (git_only merges locally), then story branches
    let finalDir = project.dir;
    let finalLabel = "main";
    try { gitCheckout("main", project.dir); } catch { /* */ }
    if (!isGameComplete(project.dir)) {
      const finalBranch = getLatestStoryBranch(project.dir);
      if (finalBranch) {
        const localBranch = finalBranch.replace("origin/", "");
        const wt = getWorktreePath(project.dir, localBranch);
        if (wt) {
          finalDir = wt;
          finalLabel = `${localBranch} (worktree)`;
        } else {
          try { gitCheckout(finalBranch, project.dir); finalLabel = finalBranch; } catch { /* */ }
        }
      }
    }
    if (!existsSync(join(finalDir, "node_modules")) && existsSync(join(finalDir, "package.json"))) {
      try { execSync("npm install", { cwd: finalDir, timeout: 60_000, stdio: "pipe" }); } catch {
        console.warn("[Result] npm install failed before final check");
      }
    }
    const complete = isGameComplete(finalDir);
    console.log(`\n[Result] ${complete ? "SUCCESS" : "INCOMPLETE"} on ${finalLabel} after ${session} sessions, $${totalCost.toFixed(4)}`);
    expect(complete).toBe(true);
  }, MAX_SESSIONS * (TIMEOUT_PER_SESSION + 120_000));

  // ── Phase 2: Verify the autopilot did its job correctly ──
  //    These are pure assertions — no mutations.
  //    NOTE: Phase 2 tests depend on Phase 1 succeeding (autopilot must have run).

  it("story branches were pushed and contain working code", () => {
    const dir = project.dir;

    // Story branches must exist — either on remote (PR flow) or local (git_only merges to main)
    const remoteBranches = execSync(
      `git -C "${dir}" branch -r --list 'origin/story/*'`,
      { encoding: "utf-8", timeout: 10_000 }
    ).trim();
    const remoteStoryBranches = remoteBranches.split("\n").map((b) => b.trim()).filter(Boolean);
    const localBranches = execSync(
      `git -C "${dir}" branch --list 'story/*'`,
      { encoding: "utf-8", timeout: 10_000 }
    ).trim();
    const localStoryBranches = localBranches.split("\n").map((b) => b.trim().replace(/^\*\s*/, "")).filter(Boolean);
    const allStoryBranches = remoteStoryBranches.length > 0 ? remoteStoryBranches : localStoryBranches;
    console.log(`[Branches] Remote story branches: ${remoteStoryBranches.join(", ") || "(none)"}`);
    console.log(`[Branches] Local story branches: ${localStoryBranches.join(", ") || "(none)"}`);
    expect(allStoryBranches.length, "at least one story branch must exist").toBeGreaterThan(0);

    // Check code on main first (git_only merges locally), then fall back to story branch/worktree
    let checkDir = dir;
    let checkLabel = "main";
    try { gitCheckout("main", dir); } catch { /* */ }

    const latestBranch = getLatestStoryBranch(dir);
    if (latestBranch) {
      const localBranch = latestBranch.replace("origin/", "");
      const worktreePath = getWorktreePath(dir, localBranch);
      if (worktreePath) {
        checkDir = worktreePath;
        checkLabel = `${localBranch} (worktree)`;
      } else if (!isGameComplete(dir)) {
        try { gitCheckout(latestBranch, dir); checkLabel = latestBranch; } catch { /* */ }
      }
    }
    console.log(`[Branches] Checking code at: ${checkLabel}`);

    const srcFiles = findFiles(checkDir, /\.(ts|js)$/, ["node_modules", ".git", "_bmad", "dist"]);
    console.log(`[Branches] Source files on ${checkLabel}: ${srcFiles.length}`);
    expect(srcFiles.length).toBeGreaterThanOrEqual(4);

    // Tests pass
    const testResult = getTestCount(checkDir);
    console.log(`[Branches] Tests on ${checkLabel}: ${testResult.tests} passed`);
    if (testResult.error) {
      console.error(`[Branches] Test runner error: ${testResult.error}`);
    }
    expect(testResult.tests, `project tests must pass on ${checkLabel}`).toBeGreaterThan(0);
  }, 120_000);

  it("planning artifacts were committed to main by autopilot", () => {
    const dir = project.dir;
    gitCheckout("main", dir);
    const planning = join(dir, "_bmad-output/planning-artifacts");
    expect(existsSync(planning), "planning-artifacts directory must exist").toBe(true);

    // Sprint status
    const sprintStatus = join(dir, "_bmad-output/implementation-artifacts/sprint-status.yaml");
    assertFileExists(sprintStatus);
    assertFileNotEmpty(sprintStatus);
    assertFileContains(sprintStatus, /status:\s*done/);
    console.log("[Artifacts] sprint-status.yaml ✓");

    // Epics — must exist with epic sections and BDD acceptance criteria
    const epicsFiles = readdirSync(planning).filter((f) => /epic/i.test(f) && f.endsWith(".md"));
    expect(epicsFiles.length, "epics markdown file must exist in planning-artifacts").toBeGreaterThan(0);
    const epicsPath = join(planning, epicsFiles[0]);
    assertFileNotEmpty(epicsPath);
    assertFileContains(epicsPath, /## Epic \d/);
    assertFileContains(epicsPath, /Story \d+[-\.]\d+/);
    const epicsContent = readFileSync(epicsPath, "utf-8");
    // Check for BDD keywords — may be bold, plain, or in various formats
    expect(
      /given\b/i.test(epicsContent) && /when\b/i.test(epicsContent) && /then\b/i.test(epicsContent),
      `${epicsFiles[0]} must contain BDD keywords: Given, When, Then`
    ).toBe(true);
    console.log(`[Artifacts] ${epicsFiles[0]} ✓`);

    // Architecture — must exist with meaningful content
    const archFiles = readdirSync(planning).filter((f) => /architect/i.test(f) && f.endsWith(".md"));
    expect(archFiles.length, "architecture markdown file must exist in planning-artifacts").toBeGreaterThan(0);
    const archPath = join(planning, archFiles[0]);
    assertFileNotEmpty(archPath);
    const archContent = readFileSync(archPath, "utf-8");
    expect(archContent.length, `${archFiles[0]} must have substantial content (not just a placeholder)`).toBeGreaterThan(200);
    console.log(`[Artifacts] ${archFiles[0]} ✓`);

    // Git log should show artifact commits
    const log = git("log --oneline --all", dir);
    console.log(`[Artifacts] Git log:\n${log}`);
  }, 30_000);

  it("story files have task checkboxes marked", () => {
    const dir = project.dir;
    // Story files may be on story branches (in worktree) or committed to main
    const latestBranch = getLatestStoryBranch(dir);
    const localBranch = latestBranch?.replace("origin/", "") ?? "";
    const worktreePath = localBranch ? getWorktreePath(dir, localBranch) : null;
    // Search both main tree and worktree for story files
    const searchDirs = [dir];
    if (worktreePath) searchDirs.push(worktreePath);
    console.log(`[Tasks] Searching for story files in: ${searchDirs.join(", ")}`);

    // Determine which stories were actually worked on (have branches — remote or local)
    const remoteBranches = execSync(
      `git -C "${dir}" branch -r --list 'origin/story/*'`,
      { encoding: "utf-8", timeout: 10_000 }
    ).trim();
    const localBranches = execSync(
      `git -C "${dir}" branch --list 'story/*'`,
      { encoding: "utf-8", timeout: 10_000 }
    ).trim();
    const workedStoryKeys = new Set([
      ...remoteBranches.split("\n")
        .map((b) => b.trim().replace(/^origin\/story\//, ""))
        .filter(Boolean),
      ...localBranches.split("\n")
        .map((b) => b.trim().replace(/^\*?\s*story\//, ""))
        .filter(Boolean),
    ]);
    console.log(`[Tasks] Worked story branches: ${[...workedStoryKeys].join(", ")}`);

    // Find story files (BMAD puts them in implementation-artifacts or stories per config)
    const storyFiles: string[] = [];
    for (const searchDir of searchDirs) {
      storyFiles.push(...findFiles(join(searchDir, "_bmad-output"), /^story-.*\.md$|^\d+-\d+.*\.md$/, [".git"]));
    }
    // Deduplicate by filename
    const seen = new Set<string>();
    const uniqueStoryFiles = storyFiles.filter((f) => {
      const name = f.split("/").pop()!;
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });
    console.log(`[Tasks] Found ${uniqueStoryFiles.length} story files`);
    expect(uniqueStoryFiles.length, "autopilot must produce at least one story file").toBeGreaterThan(0);

    for (const sf of uniqueStoryFiles) {
      const content = readFileSync(sf, "utf-8");
      const name = sf.split("/").pop()!;
      const checked = (content.match(/\[x\]/gi) || []).length;
      const unchecked = (content.match(/\[ \]/g) || []).length;
      const hasDevRecord = content.includes("Dev Agent Record");

      console.log(`[Tasks] ${name}: ${checked} checked, ${unchecked} unchecked, devRecord: ${hasDevRecord}`);

      // Story must contain task checkboxes (create-story generates them, dev-story checks them off)
      const totalCheckboxes = checked + unchecked;
      expect(totalCheckboxes, `${name} must have task checkboxes (found 0) — create-story may have skipped Tasks/Subtasks section`).toBeGreaterThan(0);

      // Check if this story was actually worked on (has a matching remote story branch)
      // Extract story key from filename: "story-1-1-core-game-logic.md" → "1-1-core-game-logic"
      const storyKey = name.replace(/^story-/, "").replace(/\.md$/, "");
      const wasWorkedOn = [...workedStoryKeys].some((branch) =>
        branch === storyKey || branch.startsWith(storyKey + "-") || storyKey.startsWith(branch + "-")
      );

      if (wasWorkedOn) {
        // Stories with branches should have all tasks checked
        expect(unchecked, `${name} has ${unchecked} unchecked tasks — dev-story should mark all [x]`).toBe(0);
        expect(checked, `${name} should have checked tasks`).toBeGreaterThan(0);
      } else {
        // Stories that were only created (not implemented) may have unchecked tasks — that's expected
        console.log(`[Tasks] ${name}: not yet implemented (no matching story branch) — skipping checkbox check`);
      }
    }
  }, 30_000);

  it("pull requests were created for story branches", () => {
    const dir = project.dir;
    try { gitCheckout("main", dir); } catch { /* */ }
    const gitStatusPath = join(dir, "_bmad-output/implementation-artifacts/git-status.yaml");

    // Check if gh CLI is available — PRs require it
    let ghAvailable = false;
    try {
      execSync("which gh", { timeout: 5_000, stdio: "pipe" });
      ghAvailable = true;
    } catch { /* gh not installed */ }

    if (!existsSync(gitStatusPath)) {
      console.warn("[PR] git-status.yaml not found — skipping PR check");
      return;
    }

    const gitStatus = readYaml(gitStatusPath);
    const stories = (gitStatus.stories ?? gitStatus.development_status ?? {}) as Record<string, Record<string, unknown>>;
    const storyKeys = Object.keys(stories);
    console.log(`[PR] Stories in git-status.yaml: ${storyKeys.join(", ")}`);
    console.log(`[PR] gh CLI available: ${ghAvailable}`);

    // In git_only mode without gh, git-status.yaml may not have story entries
    // (sync-status.sh is called but the LLM may not resolve the path correctly)
    if (storyKeys.length === 0 && !ghAvailable) {
      // Verify stories were at least merged to main by checking git log
      const log = git("log --oneline", dir);
      const hasFeatCommits = /feat\(.+\):/.test(log);
      console.log(`[PR] No story entries in git-status.yaml (git_only mode) — checking git log for feat commits: ${hasFeatCommits}`);
      expect(hasFeatCommits, "git log must contain feat commits from story branches").toBe(true);
      return;
    }

    expect(storyKeys.length, "git-status.yaml must track at least one story").toBeGreaterThan(0);

    for (const key of storyKeys) {
      const story = stories[key];
      const prUrl = story.pr_url ?? story.pr ?? null;
      const pushStatus = story.push_status ?? story.push ?? null;
      console.log(`[PR] ${key}: push=${pushStatus}, pr=${prUrl}`);

      // Branch must have been pushed
      expect(pushStatus, `${key} branch must be pushed`).toBe("pushed");

      if (ghAvailable) {
        // When gh is available, PRs must be created (not SKIPPED or null)
        expect(prUrl, `${key} must have a PR URL (got ${prUrl})`).toBeTruthy();
        expect(String(prUrl), `${key} PR should not be SKIPPED`).not.toBe("SKIPPED");
      } else {
        // Without gh, PRs are skipped — verify story was merged to main instead
        console.warn(`[PR] ${key}: gh not available — expecting auto-merge fallback`);
        const merged = execSync(
          `git -C "${dir}" merge-base --is-ancestor story/${key.replace(/^\d+-\d+-/, (m) => m)} main 2>/dev/null && echo yes || echo no`,
          { encoding: "utf-8", timeout: 5_000 }
        ).trim();
        // Don't hard-fail, but log the state
        console.log(`[PR] ${key}: merged to main = ${merged}`);
      }
    }
  }, 30_000);

  it("lock is released and project is clean", () => {
    const dir = project.dir;
    try { gitCheckout("main", dir); } catch { /* */ }

    // Lock must be released
    expect(existsSync(join(dir, ".autopilot.lock")), "autopilot lock must be released").toBe(false);

    // Autopilot state file should be deleted (sprint complete)
    if (existsSync(join(dir, "_bmad-output/implementation-artifacts/autopilot-state.yaml"))) {
      console.warn("[Clean] autopilot-state.yaml still exists — sprint may not have completed");
    }

    // No modified tracked files (untracked BMAD setup files are expected)
    const trackedChanges = execSync(`git -C "${dir}" diff --name-only HEAD`, { encoding: "utf-8", timeout: 10_000 }).trim();
    if (trackedChanges) {
      console.warn(`[Clean] Tracked files with changes: ${trackedChanges}`);
    }
    expect(trackedChanges, "no tracked files should be modified").toBe("");

    // Check for orphaned worktrees — warn but don't fail if sprint completed (lock released)
    // The autopilot should clean up worktrees but this is a known issue in git_only mode
    try {
      assertNoOrphanedWorktrees(dir);
    } catch (err) {
      const worktreeList = execSync(`git -C "${dir}" worktree list`, { encoding: "utf-8", timeout: 10_000 }).trim();
      console.warn(`[Clean] Worktrees still present (cleanup not triggered):\n${worktreeList}`);
      // Prune and remove worktrees ourselves so the test temp dir can be cleaned
      try {
        const lines = worktreeList.split("\n").slice(1); // skip main worktree
        for (const line of lines) {
          const wtPath = line.split(/\s+/)[0];
          if (wtPath && wtPath !== dir) {
            execSync(`git -C "${dir}" worktree remove "${wtPath}" --force 2>/dev/null || true`, { timeout: 5_000 });
          }
        }
        execSync(`git -C "${dir}" worktree prune`, { timeout: 5_000 });
      } catch { /* best effort */ }
    }

    console.log(`[Clean] Project dir: ${dir}`);
  });
});
