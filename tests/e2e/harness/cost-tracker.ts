/**
 * Tracks API costs across e2e test invocations.
 */

interface CostEntry {
  test: string;
  skill: string;
  costUsd: number;
  durationMs: number;
  timestamp: Date;
}

class CostTracker {
  private entries: CostEntry[] = [];

  record(test: string, skill: string, costUsd: number, durationMs: number): void {
    this.entries.push({
      test,
      skill,
      costUsd,
      durationMs,
      timestamp: new Date(),
    });
  }

  get totalCost(): number {
    return this.entries.reduce((sum, e) => sum + e.costUsd, 0);
  }

  get totalDuration(): number {
    return this.entries.reduce((sum, e) => sum + e.durationMs, 0);
  }

  report(): string {
    const lines = [
      "╔══════════════════════════════════════════════╗",
      "║         BMAD E2E Test Cost Report            ║",
      "╠══════════════════════════════════════════════╣",
    ];

    for (const entry of this.entries) {
      const cost = `$${entry.costUsd.toFixed(4)}`;
      const dur = `${(entry.durationMs / 1000).toFixed(1)}s`;
      lines.push(`║ ${entry.skill.padEnd(30)} ${cost.padStart(8)} ${dur.padStart(6)} ║`);
    }

    lines.push("╠══════════════════════════════════════════════╣");
    lines.push(
      `║ TOTAL${" ".repeat(24)} $${this.totalCost.toFixed(4).padStart(7)} ${((this.totalDuration / 1000).toFixed(1) + "s").padStart(6)} ║`
    );
    lines.push("╚══════════════════════════════════════════════╝");

    return lines.join("\n");
  }
}

/** Singleton cost tracker for the test suite */
export const costTracker = new CostTracker();
