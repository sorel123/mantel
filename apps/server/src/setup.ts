/**
 * First-run and wizard progress. `firstRun` is derived (no PIN, no paired display); the step
 * states and the completed flag are what the wizard saves.
 */
import type { SetupState, SetupStepState } from '@mantel/shared';
import { SETUP_STEPS } from '@mantel/shared';
import type { DeviceAuth } from './auth.js';
import { kvGet, kvSet, type Db } from './db/index.js';

const KEY = 'setup.state';

interface Stored {
  completed: boolean;
  steps: Record<string, SetupStepState>;
}

export class SetupStore {
  constructor(
    private readonly db: Db,
    private readonly auth: DeviceAuth,
  ) {}

  private stored(): Stored {
    const s = kvGet<Partial<Stored>>(this.db, KEY);
    return { completed: s?.completed ?? false, steps: s?.steps ?? {} };
  }

  get(): SetupState {
    const s = this.stored();
    const steps: Record<string, SetupStepState> = {};
    for (const step of SETUP_STEPS) steps[step] = s.steps[step] ?? 'todo';
    for (const [k, v] of Object.entries(s.steps)) steps[k] ??= v;
    return {
      firstRun: this.auth.firstRun(),
      pinSet: this.auth.pinSet(),
      completed: s.completed,
      steps,
    };
  }

  put(patch: { steps?: Record<string, SetupStepState>; completed?: boolean }): SetupState {
    const s = this.stored();
    const next: Stored = {
      completed: patch.completed ?? s.completed,
      steps: { ...s.steps, ...patch.steps },
    };
    kvSet(this.db, KEY, next);
    return this.get();
  }

  /** Mark a step done from server-side knowledge (the PIN was set, a calendar connected). */
  markDone(step: string): void {
    const s = this.stored();
    if (s.steps[step] === 'done') return;
    kvSet(this.db, KEY, { ...s, steps: { ...s.steps, [step]: 'done' } } satisfies Stored);
  }
}
