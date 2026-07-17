#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const schemaPath = process.argv[2] || path.join(process.cwd(), 'schema/aws-provider-schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const providers = schema.provider_schemas || schema.providerSchemas || {};
const providerKey = Object.keys(providers).find((key) => key.endsWith('/hashicorp/aws'));
const aws = providerKey ? providers[providerKey] : undefined;
if (!aws) throw new Error(`AWS provider schema not found in ${schemaPath}`);

const generatedRoot = path.join(process.cwd(), '.gen/providers/aws');
const mustExist = [
  ['provider-functions/index.ts', 'provider function bindings'],
  ['ephemeral-aws-secretsmanager-random-password/index.ts', 'ephemeral resource bindings'],
];
for (const [rel, label] of mustExist) {
  if (!fs.existsSync(path.join(generatedRoot, rel))) {
    throw new Error(`${label} missing: ${rel}`);
  }
}

const count = (key) => Object.keys(aws[key] || {}).length;
const capabilities = {
  functions: count('functions'),
  ephemeral: count('ephemeral_resource_schemas'),
  listResources: count('list_resource_schemas'),
  actions: count('action_schemas'),
  resourceIdentities: count('resource_identity_schemas'),
};
if (capabilities.functions < 1) throw new Error('schema has no provider-defined functions');
if (capabilities.ephemeral < 1) throw new Error('schema has no ephemeral resources');
if (capabilities.resourceIdentities < 1) throw new Error('schema has no resource identities');

const topLevelDirs = fs.readdirSync(generatedRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const generatedListLike = topLevelDirs.filter((name) => name.startsWith('list-') || name.startsWith('list-resource-'));
const generatedActionLike = topLevelDirs.filter((name) => name.startsWith('action-') || name.startsWith('provider-action-'));
const generatedIdentityLike = topLevelDirs.filter((name) => name.startsWith('identity-') || name.startsWith('resource-identity-'));

console.log(`provider: ${providerKey}`);
console.log(`schema capabilities: ${JSON.stringify(capabilities)}`);
console.log('generated provider functions: OK');
console.log('generated ephemeral resources: OK');
console.log(`generated list/action/identity-like top-level dirs: ${JSON.stringify({ list: generatedListLike.length, action: generatedActionLike.length, identity: generatedIdentityLike.length })}`);
if (capabilities.listResources > 0 && generatedListLike.length === 0) {
  console.log('NOTE: schema exposes list_resource_schemas but no first-class list resource bindings were generated.');
}
if (capabilities.actions > 0 && generatedActionLike.length === 0) {
  console.log('NOTE: schema exposes action_schemas but no first-class provider action bindings were generated.');
}
if (capabilities.resourceIdentities > 0 && generatedIdentityLike.length === 0) {
  console.log('NOTE: schema exposes resource_identity_schemas but no first-class resource identity bindings were generated.');
}
