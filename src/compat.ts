/**
 * Backwards-compatibility helpers for the SUNNY → NEUTRON rename.
 *
 * Rule: NEUTRON names win; legacy SUNNY names are read as a fallback so that
 * existing users keep their configuration, skills, plugins and run history.
 * Nothing legacy is ever deleted or rewritten by NEUTRON.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Read NEUTRON_<name>, falling back to the legacy SUNNY_<name>. */
export function envVar(name: string): string | undefined {
  const next = process.env[`NEUTRON_${name}`];
  if (next !== undefined && next !== "") return next;
  const legacy = process.env[`SUNNY_${name}`];
  return legacy !== undefined && legacy !== "" ? legacy : undefined;
}

/** Project-level config directory names, preferred first. */
export const PROJECT_DIR = ".neutron";
export const LEGACY_PROJECT_DIR = ".sunny";

/** `<root>/.neutron/<sub>` then `<root>/.sunny/<sub>` (both returned so callers can read either). */
export function projectDirs(root: string, ...sub: string[]): string[] {
  return [join(root, PROJECT_DIR, ...sub), join(root, LEGACY_PROJECT_DIR, ...sub)];
}

/** First existing path among the candidates, else the preferred (first) one. */
export function preferExisting(candidates: string[]): string {
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

/** Project-level `.agent/` state directory names. */
export const STATE_DIR = "neutron";
export const LEGACY_STATE_DIR = "sun";

/** Git branch prefixes used for checkpoints / maintenance branches. */
export const BRANCH_PREFIX = "neutron";
export const LEGACY_BRANCH_PREFIX = "sun";

/**
 * `<root>/.agent/neutron`, unless only the legacy `<root>/.agent/sun` exists —
 * then keep using it so existing run history / state is not orphaned.
 */
export function stateDir(root: string): string {
  const next = join(root, ".agent", STATE_DIR);
  const legacy = join(root, ".agent", LEGACY_STATE_DIR);
  return !existsSync(next) && existsSync(legacy) ? legacy : next;
}
