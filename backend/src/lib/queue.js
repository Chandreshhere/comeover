'use strict';
// SQS job queue (push fan-out, quest evaluation, reliability, moderation alerts).
const { sqs } = require('./aws');

async function enqueue(job) {
  if (!process.env.JOBS_QUEUE_URL) {
    console.log(JSON.stringify({ level: 'info', msg: 'job_skipped_no_queue', type: job.type }));
    return;
  }
  const { SendMessageCommand } = require('@aws-sdk/client-sqs');
  await sqs().send(new SendMessageCommand({ QueueUrl: process.env.JOBS_QUEUE_URL, MessageBody: JSON.stringify(job) }));
}

module.exports = { enqueue };
