'use strict';
// Claude API client for the IRL Guide. Key comes from Secrets Manager
// (ANTHROPIC_SECRET_ARN → {"apiKey": "..."}) or ANTHROPIC_API_KEY locally.
const { Anthropic } = require('@anthropic-ai/sdk');

const MODEL = process.env.ASSISTANT_MODEL || 'claude-opus-5-5';
let clientPromise;

async function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      let apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey && process.env.ANTHROPIC_SECRET_ARN) {
        const { getSecretJson } = require('./aws');
        const s = await getSecretJson(process.env.ANTHROPIC_SECRET_ARN);
        apiKey = s.apiKey || s.ANTHROPIC_API_KEY;
      }
      if (!apiKey) return null;
      // API Gateway caps requests at 30 s: one bounded attempt plus one retry.
      return new Anthropic({ apiKey, timeout: 12000, maxRetries: 1 });
    })();
    clientPromise.catch(() => {
      clientPromise = undefined;
    });
  }
  return clientPromise;
}

module.exports = { MODEL, getClient, Anthropic };
