#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repo = process.env.CDKTN_REPO;
if (!repo) {
  console.error('CDKTN_REPO is required, e.g. CDKTN_REPO=/path/to/cdk-terrain-pr-head');
  process.exit(1);
}

const cdktnPkg = path.resolve(repo, 'packages/cdktn');
const cli = path.resolve(repo, 'packages/cdktn-cli/bundle/bin/cdktn.js');
if (!fs.existsSync(path.join(cdktnPkg, 'package.json'))) {
  console.error(`cdktn package not found at ${cdktnPkg}`);
  process.exit(1);
}
if (!fs.existsSync(cli)) {
  console.error(`cdktn CLI bundle not found at ${cli}. Build the PR head first.`);
  process.exit(1);
}

const result = spawnSync('pnpm', ['add', `cdktn@file:${cdktnPkg}`], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status ?? 1);
