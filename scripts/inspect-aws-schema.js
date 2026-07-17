#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const schemaPath = process.argv[2] || path.join(process.cwd(), 'schema/aws-provider-schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const providers = schema.provider_schemas || schema.providerSchemas || {};
const providerKey = Object.keys(providers).find((key) => key.endsWith('/hashicorp/aws'));
const aws = providerKey ? providers[providerKey] : undefined;
if (!aws) throw new Error(`AWS provider schema not found in ${schemaPath}`);
console.log(`provider: ${providerKey}`);

const keys = [
  'functions',
  'ephemeral_resource_schemas',
  'list_resource_schemas',
  'action_schemas',
  'resource_identity_schemas',
  'resource_schemas',
  'data_source_schemas',
];
for (const key of keys) {
  const value = aws[key] || {};
  const names = Object.keys(value);
  console.log(`${key}: ${names.length}${names.length ? ` (${names.slice(0, 12).join(', ')}${names.length > 12 ? ', …' : ''})` : ''}`);
}

const generatedRoot = path.join(process.cwd(), '.gen/providers/aws');
const expected = {
  'provider-functions/index.ts': 'provider function bindings',
  'ephemeral-aws-secretsmanager-random-password/index.ts': 'ephemeral resource bindings',
};
for (const [rel, label] of Object.entries(expected)) {
  const exists = fs.existsSync(path.join(generatedRoot, rel));
  console.log(`${label}: ${exists ? 'present' : 'missing'} (${rel})`);
}
