export interface HealthCheckConfig {
  name: string;
  checkFn: () => Promise<boolean>;
  timeoutMs?: number;
  criticalOnFail?: boolean;
}

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  durationMs: number;
  error?: string;
  critical: boolean;
}

export interface AggregateHealthResult {
  status: HealthStatus;
  checks: HealthCheckResult[];
  totalDurationMs: number;
  timestamp: number;
}

export class HealthChecker {
  private readonly checks: HealthCheckConfig[] = [];

  public register(check: HealthCheckConfig): void {
    if (this.checks.some((c) => c.name === check.name)) {
      throw new Error(`Health check "${check.name}" is already registered`);
    }
    this.checks.push(check);
  }

  public unregister(name: string): boolean {
    const index = this.checks.findIndex((c) => c.name === name);
    if (index === -1) return false;
    this.checks.splice(index, 1);
    return true;
  }

  public async runAll(names?: string[]): Promise<AggregateHealthResult> {
    const startTime = Date.now();
    const checksToRun = names
      ? this.checks.filter((c) => names.includes(c.name))
      : this.checks;

    const results = await Promise.all(
      checksToRun.map((check) => this.runSingle(check))
    );

    const totalDurationMs = Date.now() - startTime;
    const hasCriticalFailure = results.some(
      (r) => r.critical && r.status === "unhealthy"
    );
    const hasAnyDegraded = results.some((r) => r.status !== "healthy");

    let status: HealthStatus;
    if (hasCriticalFailure) {
      status = "unhealthy";
    } else if (hasAnyDegraded) {
      status = "degraded";
    } else {
      status = "healthy";
    }

    return { status, checks: results, totalDurationMs, timestamp: Date.now() };
  }

  private async runSingle(config: HealthCheckConfig): Promise<HealthCheckResult> {
    const timeoutMs = config.timeoutMs ?? 5000;
    const critical = config.criticalOnFail ?? false;
    const start = Date.now();

    try {
      const passed = await Promise.race([
        config.checkFn(),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);

      const durationMs = Date.now() - start;
      return {
        name: config.name,
        status: passed ? "healthy" : "degraded",
        durationMs,
        critical,
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      return {
        name: config.name,
        status: "unhealthy",
        durationMs,
        error: err instanceof Error ? err.message : String(err),
        critical,
      };
    }
  }
}
