#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repo = path.resolve(process.env.CDKTN_REPO || '../../../cdk-terrain');
const expectedCdktn = path.resolve(repo, 'packages/cdktn');
const lockPath = path.join(process.cwd(), 'pnpm-lock.yaml');
const lock = fs.readFileSync(lockPath, 'utf8');
const expectedLockFragments = [
  `file:${expectedCdktn}`,
  path.relative(process.cwd(), expectedCdktn).replaceAll('\\', '/'),
  expectedCdktn.replaceAll('\\', '/'),
];

if (!expectedLockFragments.some((fragment) => lock.includes(fragment))) {
  throw new Error(`demo dependency "cdktn" is not locked to PR-head package ${expectedCdktn}`);
}

const forbiddenRegistryPatterns = [
  /\/cdktn\/[0-9][^\n]*/,
  /\/(@cdktn\/[^/]+)\/[0-9][^\n]*/,
];
for (const pattern of forbiddenRegistryPatterns) {
  const match = lock.match(pattern);
  if (match) {
    throw new Error(`lockfile appears to contain a registry CDK Terrain package entry: ${match[0]}`);
  }
}

const cli = path.join(repo, 'packages/cdktn-cli/bundle/bin/cdktn.js');
if (!fs.existsSync(cli)) {
  throw new Error(`PR-head cdktn CLI bundle not found: ${cli}`);
}

const installedPkg = require.resolve('cdktn/package.json', { paths: [process.cwd()] });
const installedReal = fs.realpathSync(path.dirname(installedPkg));
const pnpmFileMarker = 'cdktn@file+' + path.relative(process.cwd(), expectedCdktn).replaceAll('..', '+..').replaceAll('/', '+');
if (!installedReal.includes('cdktn@file+') || !installedReal.includes('packages+cdktn')) {
  throw new Error(`cdktn resolves to ${installedReal}, expected a pnpm file dependency sourced from PR-head packages/cdktn`);
}

console.log(`cdktn package install: ${installedReal}`);
console.log(`cdktn package source: ${expectedCdktn}`);
console.log(`cdktn CLI: ${cli}`);
console.log('OK: cdk-terrain packages under test resolve from PR head, not npmjs.');
