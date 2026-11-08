'use strict';
// Mongo-backed job queue + cron schedules (replaces SQS + EventBridge).
//
//   const jobs = require('../lib/jobs');
//   await jobs.enqueue('push', { userIds, notification });                 // or enqueue({ type: 'push', ... }) (legacy form)
//   await jobs.enqueue('quest_evaluate', { userId }, { dedupeKey: `qe:${userId}`, delayMs: 5000 });
//   jobs.register('push', async (payload) => { ... });                     // in src/jobs/index.js
//   jobs.schedule('lifecycle', '*/15 * * * *', async () => { ... });       // runs on ONE instance per slot
//
// Delivery is at-least-once: handlers must be idempotent. Failed jobs retry
// with exponential backoff up to maxAttempts.
const config = require('../config');
const logger = require('../logger');

const handlers = new Map();
const schedules = new Map();
let timer = null;
let running = false;
let instanceId = null;
const cronTasks = [];

function register(type, fn) {
  handlers.set(type, fn);
}

async function enqueue(typeOrJob, payload, opts = {}) {
  const { Job } = require('../models');
  let type = typeOrJob;
  let data = payload;
  if (typeOrJob && typeof typeOrJob === 'object') {
    ({ type, ...data } = typeOrJob);
    opts = payload || {};
  }
  const runAt = opts.runAt || new Date(Date.now() + (opts.delayMs || 0));
  const doc = { type, payload: data || {}, runAt, maxAttempts: opts.maxAttempts || 5, ...(opts.dedupeKey ? { dedupeKey: opts.dedupeKey } : {}) };
  try {
    const [job] = await Job.create([doc], opts.session ? { session: opts.session } : undefined);
    return job;
  } catch (e) {
    if (e && e.code === 11000 && opts.dedupeKey) return null; // an identical job is already queued
    throw e;
  }
}

async function claimOne() {
  const { Job } = require('../models');
  const now = new Date();
  return Job.findOneAndUpdate(
    { $or: [{ status: 'queued', runAt: { $lte: now } }, { status: 'running', lockedUntil: { $lt: now } }] },
    { $set: { status: 'running', lockedUntil: new Date(now.getTime() + 5 * 60000), lockedBy: instanceId }, $inc: { attempts: 1 } },
    { sort: { runAt: 1 }, new: true }
  ).lean();
}

async function runJob(job) {
  const { Job } = require('../models');
  const fn = handlers.get(job.type);
  try {
    if (!fn) throw new Error(`no handler for job type "${job.type}"`);
    await fn(job.payload || {}, job);
    await Job.updateOne({ _id: job._id }, { $set: { status: 'done', finishedAt: new Date(), lockedUntil: null, lastError: null } });
  } catch (e) {
    const final = !fn || job.attempts >= job.maxAttempts;
    const backoffMs = Math.min(3600000, 10000 * 2 ** Math.max(0, job.attempts - 1));
    await Job.updateOne(
      { _id: job._id },
      final
        ? { $set: { status: 'failed', finishedAt: new Date(), lockedUntil: null, lastError: String(e.message || e).slice(0, 500) } }
        : { $set: { status: 'queued', runAt: new Date(Date.now() + backoffMs), lockedUntil: null, lastError: String(e.message || e).slice(0, 500) } }
    );
    logger[final ? 'error' : 'warn']({ msg: 'job_failed', type: job.type, id: job._id, attempt: job.attempts, final, err: e.message });
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    for (let i = 0; i < 20; i++) {
      const job = await claimOne();
      if (!job) break;
      await runJob(job);
    }
  } catch (e) {
    logger.error({ msg: 'jobs_tick_failed', err: e.message });
  } finally {
    running = false;
  }
}

// Cron: every instance's timer fires, but only one wins the per-slot dedupe key.
function schedule(name, cronExpr, fn) {
  schedules.set(name, { cronExpr, fn });
  register(`cron:${name}`, () => fn());
}

function start({ id } = {}) {
  if (!config.jobs.enabled || timer) return;
  instanceId = id || require('./realtime').INSTANCE_ID;
  const cron = require('node-cron');
  for (const [name, { cronExpr }] of schedules) {
    cronTasks.push(
      cron.schedule(cronExpr, () => {
        const slot = new Date();
        slot.setSeconds(0, 0);
        enqueue(`cron:${name}`, {}, { dedupeKey: `cron:${name}:${slot.toISOString()}`, maxAttempts: 1 }).catch((e) => logger.error({ msg: 'cron_enqueue_failed', name, err: e.message }));
      })
    );
  }
  timer = setInterval(tick, config.jobs.pollMs);
  timer.unref();
  logger.info({ msg: 'jobs_started', handlers: [...handlers.keys()], schedules: [...schedules.keys()] });
}

async function stop() {
  clearInterval(timer);
  timer = null;
  cronTasks.splice(0).forEach((t) => t.stop());
  while (running) await new Promise((r) => setTimeout(r, 50));
}

// Test helper: run everything that is due now.
async function drain() {
  await tick();
}

module.exports = { register, enqueue, schedule, start, stop, drain, handlers, schedules };
