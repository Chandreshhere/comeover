#!/usr/bin/env node
'use strict';
// Generates template.yaml (AWS SAM) from the route tables exported by each
// handler, so API Gateway routes can never drift from the code.
//   node scripts/build-template.js        → writes template.yaml
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Lambda groups. `auth`: AppAuth (default) | AdminAuth | NONE.
const GROUPS = [
  { fn: 'AuthFunction', file: 'auth', auth: 'NONE', env: { USER_POOL_CLIENT_ID: '!Ref UserPoolClient' }, policies: ['db'] },
  { fn: 'ProfileFunction', file: 'profile', env: { USER_POOL_ID: '!Ref UserPool' }, policies: ['db', 'queue', 'ws', 'media', 'cognitoAdmin'] },
  { fn: 'DiscoveryFunction', file: 'discovery', policies: ['db', 'media'] },
  { fn: 'ActivitiesFunction', file: 'activities', policies: ['db', 'queue', 'ws', 'media'] },
  { fn: 'MessagingFunction', file: 'messaging', policies: ['db', 'queue', 'ws', 'media'] },
  { fn: 'CirclesFunction', file: 'circles', policies: ['db', 'queue', 'ws', 'media'] },
  { fn: 'ProgressFunction', file: 'progress', policies: ['db'] },
  { fn: 'ExpensesFunction', file: 'expenses', policies: ['db', 'queue', 'ws', 'media'] },
  { fn: 'MonetizationFunction', file: 'monetization', policies: ['db', 'media', 'appSecrets'] },
  { fn: 'SafetyFunction', file: 'safety', policies: ['db', 'queue', 'ws', 'media', 'sms'] },
  { fn: 'AssistantFunction', file: 'assistant', timeout: 29, memory: 1024, policies: ['db', 'media', 'appSecrets'] },
  { fn: 'WebhooksFunction', file: 'webhooks', auth: 'NONE', policies: ['db', 'appSecrets'] },
  { fn: 'AdminFunction', file: 'admin', auth: 'AdminAuth', env: { USER_POOL_ID: '!Ref UserPool' }, policies: ['db', 'queue', 'ws', 'media', 'cognitoAdmin'] },
];

function loadRoutes(file) {
  const mod = require(path.join(ROOT, 'src', 'handlers', `${file}.js`));
  if (!mod.handler || !Array.isArray(mod.handler.routes)) throw new Error(`${file}.js must export handler created with createRouter`);
  return mod.handler.routes;
}

function eventName(routeKey, used) {
  const [method, p] = routeKey.split(' ');
  const base =
    method.charAt(0) + method.slice(1).toLowerCase() +
    p
      .split('/')
      .filter(Boolean)
      .map((s) => s.replace(/[{}]/g, '').replace(/[^A-Za-z0-9]/g, ' ').split(' ').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(''))
      .join('');
  let name = base.slice(0, 200);
  let i = 2;
  while (used.has(name)) name = `${base}${i++}`;
  used.add(name);
  return name;
}

const POLICY = {
  db: `        - Statement:
            - Effect: Allow
              Action: secretsmanager:GetSecretValue
              Resource: !Ref DbSecretArn`,
  appSecrets: `        - Statement:
            - Effect: Allow
              Action: secretsmanager:GetSecretValue
              Resource: !Sub arn:\${AWS::Partition}:secretsmanager:\${AWS::Region}:\${AWS::AccountId}:secret:irl/*`,
  queue: `        - SQSSendMessagePolicy:
            QueueName: !GetAtt JobsQueue.QueueName`,
  ws: `        - Statement:
            - Effect: Allow
              Action: execute-api:ManageConnections
              Resource: !Sub arn:\${AWS::Partition}:execute-api:\${AWS::Region}:\${AWS::AccountId}:\${WebSocketApi}/*`,
  media: `        - S3CrudPolicy:
            BucketName: !Ref MediaBucket`,
  sms: `        - Statement:
            - Effect: Allow
              Action: sns:Publish
              Resource: '*'
              Condition:
                StringEquals:
                  aws:RequestedRegion: !Ref AWS::Region`,
  cognitoAdmin: `        - Statement:
            - Effect: Allow
              Action: [cognito-idp:AdminUserGlobalSignOut, cognito-idp:AdminDisableUser]
              Resource: !GetAtt UserPool.Arn`,
  moderationTopic: `        - SNSPublishMessagePolicy:
            TopicName: !GetAtt ModerationTopic.TopicName`,
};

function fnBlock({ fn, handler, timeout, memory, env = {}, policies = [], events = '' }) {
  const envLines = Object.entries(env)
    .map(([k, v]) => `          ${k}: ${v}`)
    .join('\n');
  return `  ${fn}:
    Type: AWS::Serverless::Function
    Properties:
      Handler: ${handler}${timeout ? `\n      Timeout: ${timeout}` : ''}${memory ? `\n      MemorySize: ${memory}` : ''}${envLines ? `\n      Environment:\n        Variables:\n${envLines}` : ''}
      Policies:
${policies.map((p) => POLICY[p]).join('\n')}${events ? `\n      Events:\n${events}` : ''}
`;
}

function httpEvents(group) {
  const used = new Set();
  return loadRoutes(group.file)
    .map((rk) => {
      const [method, p] = rk.split(' ');
      const auth = group.auth === 'NONE' ? '\n            Auth:\n              Authorizer: NONE' : group.auth === 'AdminAuth' ? '\n            Auth:\n              Authorizer: AdminAuth' : '';
      return `        ${eventName(rk, used)}:
          Type: HttpApi
          Properties:
            ApiId: !Ref HttpApi
            Method: ${method}
            Path: ${p}${auth}`;
    })
    .join('\n');
}

const triggers = [
  ['PreSignUpFunction', 'preSignUp', ['db']],
  ['DefineAuthChallengeFunction', 'defineAuthChallenge', ['db']],
  ['CreateAuthChallengeFunction', 'createAuthChallenge', ['db', 'sms']],
  ['VerifyAuthChallengeFunction', 'verifyAuthChallenge', ['db']],
  ['PostAuthenticationFunction', 'postAuthentication', ['db']],
];

const header = fs.readFileSync(path.join(ROOT, 'infra', 'template.base.yaml'), 'utf8');

let out = header.replace(/\s+$/, '') + '\n\n  # ---------------------------------------------------------------- HTTP API Lambdas (generated)\n';
for (const g of GROUPS) out += fnBlock({ fn: g.fn, handler: `src/handlers/${g.file}.handler`, timeout: g.timeout, memory: g.memory, env: g.env, policies: g.policies, events: httpEvents(g) });

out += '\n  # ---------------------------------------------------------------- Cognito triggers (generated)\n';
for (const [fn, exp, pol] of triggers) {
  out += fnBlock({ fn, handler: `src/handlers/cognito/triggers.${exp}`, policies: pol });
  out += `  ${fn}Permission:
    Type: AWS::Lambda::Permission
    Properties:
      Action: lambda:InvokeFunction
      FunctionName: !GetAtt ${fn}.Arn
      Principal: cognito-idp.amazonaws.com
      SourceArn: !GetAtt UserPool.Arn
`;
}

out += '\n  # ---------------------------------------------------------------- Realtime + jobs (generated)\n';
out += fnBlock({ fn: 'WsFunction', handler: 'src/handlers/ws.handler', env: { USER_POOL_ID: '!Ref UserPool', USER_POOL_CLIENT_ID: '!Ref UserPoolClient' }, policies: ['db', 'ws'] });
out += fnBlock({
  fn: 'JobsFunction',
  handler: 'src/handlers/jobs.handler',
  timeout: 60,
  env: { MODERATION_TOPIC_ARN: '!Ref ModerationTopic' },
  policies: ['db', 'queue', 'ws', 'appSecrets', 'moderationTopic'],
  events: `        Jobs:
          Type: SQS
          Properties:
            Queue: !GetAtt JobsQueue.Arn
            BatchSize: 10
            FunctionResponseTypes: [ReportBatchItemFailures]`,
});
out += fnBlock({
  fn: 'ScheduledFunction',
  handler: 'src/handlers/jobs.scheduled',
  timeout: 300,
  policies: ['db', 'queue', 'ws'],
  events: `        Lifecycle:
          Type: Schedule
          Properties:
            Schedule: rate(15 minutes)
            Input: '{"task":"lifecycle"}'
        Retention:
          Type: Schedule
          Properties:
            Schedule: cron(30 21 * * ? *)
            Input: '{"task":"retention"}'`,
});

out += '\n' + fs.readFileSync(path.join(ROOT, 'infra', 'template.outputs.yaml'), 'utf8');

if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'template.yaml'), out);
  console.log(`template.yaml written (${GROUPS.reduce((n, g) => n + loadRoutes(g.file).length, 0)} HTTP routes)`);
}

module.exports = { GROUPS, loadRoutes, render: () => out };
