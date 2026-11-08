'use strict';
// Lazy AWS SDK v3 clients (created on first use so cold starts stay small and
// pure modules can be imported in tests without AWS configuration).
const clients = {};

function lazy(name, factory) {
  return () => {
    if (!clients[name]) clients[name] = factory();
    return clients[name];
  };
}

const region = () => process.env.AWS_REGION || 'ap-south-1';

const cognito = lazy('cognito', () => {
  const { CognitoIdentityProviderClient } = require('@aws-sdk/client-cognito-identity-provider');
  return new CognitoIdentityProviderClient({ region: region() });
});
const sns = lazy('sns', () => {
  const { SNSClient } = require('@aws-sdk/client-sns');
  return new SNSClient({ region: region() });
});
const s3 = lazy('s3', () => {
  const { S3Client } = require('@aws-sdk/client-s3');
  return new S3Client({ region: region() });
});
const sqs = lazy('sqs', () => {
  const { SQSClient } = require('@aws-sdk/client-sqs');
  return new SQSClient({ region: region() });
});
const secrets = lazy('secrets', () => {
  const { SecretsManagerClient } = require('@aws-sdk/client-secrets-manager');
  return new SecretsManagerClient({ region: region() });
});
const wsApi = lazy('wsApi', () => {
  const { ApiGatewayManagementApiClient } = require('@aws-sdk/client-apigatewaymanagementapi');
  return new ApiGatewayManagementApiClient({ region: region(), endpoint: process.env.WS_ENDPOINT });
});

const secretCache = new Map();
async function getSecretJson(arn) {
  if (secretCache.has(arn)) return secretCache.get(arn);
  const { GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
  const p = secrets()
    .send(new GetSecretValueCommand({ SecretId: arn }))
    .then((r) => JSON.parse(r.SecretString));
  secretCache.set(arn, p);
  p.catch(() => secretCache.delete(arn));
  return p;
}

async function sendSms(phoneE164, message) {
  const { PublishCommand } = require('@aws-sdk/client-sns');
  return sns().send(
    new PublishCommand({
      PhoneNumber: phoneE164,
      Message: message,
      MessageAttributes: {
        'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
        ...(process.env.SMS_SENDER_ID ? { 'AWS.SNS.SMS.SenderID': { DataType: 'String', StringValue: process.env.SMS_SENDER_ID } } : {}),
        // India DLT registration (required for SMS to +91): TODO(credentials)
        ...(process.env.SMS_DLT_ENTITY_ID ? { 'AWS.MM.SMS.EntityId': { DataType: 'String', StringValue: process.env.SMS_DLT_ENTITY_ID } } : {}),
        ...(process.env.SMS_DLT_TEMPLATE_ID ? { 'AWS.MM.SMS.TemplateId': { DataType: 'String', StringValue: process.env.SMS_DLT_TEMPLATE_ID } } : {}),
      },
    })
  );
}

module.exports = { cognito, sns, s3, sqs, secrets, wsApi, getSecretJson, sendSms };
