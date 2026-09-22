export interface GateResult {
  scores: Record<string, number>;
  passed: boolean;
  reasons: string[];
}

export class CompletionEngine {
  private maxIterations: number;
  private requireDesign: boolean;

  constructor(opts?: { maxIterations?: number; requireDesign?: boolean }) {
    this.maxIterations = opts?.maxIterations ?? 5;
    this.requireDesign = opts?.requireDesign ?? true;
  }

  getMaxIterations(): number {
    return this.maxIterations;
  }

  evaluate(fields: Record<string, boolean | number | undefined>): GateResult {
    const scores: Record<string, number> = {};
    const reasons: string[] = [];
    for (const [key, val] of Object.entries(fields)) {
      if (val === true) {
        scores[key] = 100;
      } else if (val === false) {
        scores[key] = 0;
        reasons.push(`${key}: FAIL`);
      } else if (typeof val === "number") {
        scores[key] = Math.max(0, Math.min(100, val));
        if (val < 100) reasons.push(`${key}: ${val}%`);
      } else {
        scores[key] = 0;
        reasons.push(`${key}: MISSING`);
      }
    }
    const failed = reasons.length > 0;
    return {
      scores,
      passed: !failed,
      reasons,
    };
  }
}