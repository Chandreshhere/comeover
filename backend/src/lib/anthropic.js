'use strict';
// Claude API client for the IRL Guide (ANTHROPIC_API_KEY). Returns null when not configured.
const { Anthropic } = require('@anthropic-ai/sdk');
const config = require('../config');

const MODEL = config.anthropic.model;
let client;

async function getClient() {
  if (client === undefined) {
    // One bounded attempt plus one retry keeps the request under typical proxy timeouts.
    client = config.anthropic.apiKey ? new Anthropic({ apiKey: config.anthropic.apiKey, timeout: 20000, maxRetries: 1 }) : null;
  }
  return client;
}

module.exports = { MODEL, getClient, Anthropic };
