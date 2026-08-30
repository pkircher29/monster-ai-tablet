import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CFG = join(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'budget.json');
const DEFAULT = { monthlyTargetUSD: 0, dailyAlertUSD: 0, _note: 'API-equivalent value thresholds. 0 = off.' };

export function loadBudget() {
  if (!existsSync(CFG)) { mkdirSync(dirname(CFG), { recursive: true }); writeFileSync(CFG, JSON.stringify(DEFAULT, null, 2)); }
  try { return { ...DEFAULT, ...JSON.parse(readFileSync(CFG, 'utf8')) }; } catch { return { ...DEFAULT }; }
}

export function saveBudget(patch) {
  const cur = loadBudget();
  const next = { ...cur };
  if (typeof patch.monthlyTargetUSD === 'number' && patch.monthlyTargetUSD >= 0) next.monthlyTargetUSD = patch.monthlyTargetUSD;
  if (typeof patch.dailyAlertUSD === 'number' && patch.dailyAlertUSD >= 0) next.dailyAlertUSD = patch.dailyAlertUSD;
  mkdirSync(dirname(CFG), { recursive: true });
  writeFileSync(CFG, JSON.stringify(next, null, 2));
  return next;
}
