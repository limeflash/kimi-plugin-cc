#!/usr/bin/env node
/**
 * Detached background-job supervisor for kimi-plugin-cc.
 *
 * Spawned by `startBackground` (job-control.mjs) as a fully detached process:
 *
 *   node supervisor.mjs <sessionId>
 *
 * It owns one background Kimi job end-to-end — spawning kimi, running the idle
 * watchdog, and finalizing the session (status/commit/telemetry/snapshot
 * cleanup) — so the broker that launched it can print the session id and exit
 * immediately. That is what makes `--background` actually background: the
 * broker holds no handles on the job, so `dispatch --background` returns at
 * once instead of blocking until the job finishes.
 *
 * All job parameters are read from the session's meta.json, so the only
 * argument is the sessionId. KIMI_PLUGIN_DATA is inherited from the broker's
 * environment, so getSessionsDir() resolves to the same store.
 *
 * The process stays alive via the child's piped stdio until kimi exits and the
 * finalization completes, then drains and exits on its own.
 */

import { superviseJob } from './job-control.mjs';
import { warn } from './warn.mjs';

const sessionId = process.argv[2];

if (!sessionId) {
  process.stderr.write('supervisor.mjs: missing sessionId argument\n');
  process.exit(2);
}

superviseJob(sessionId).catch(async (err) => {
  // Spawn-time failure (before the child's close handler is wired). Record it
  // so the session doesn't hang in 'running' forever, then exit non-zero.
  try {
    const { updateMeta } = await import('./state.mjs');
    await updateMeta(sessionId, {
      status: 'failed',
      reason: 'supervisor-error',
      error: err?.message || String(err),
      finished_at: new Date().toISOString(),
    });
  } catch { /* best-effort */ }
  await warn('supervisor', err, 'error').catch(() => {});
  process.exit(1);
});
