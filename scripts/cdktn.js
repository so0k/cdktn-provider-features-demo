#!/usr/bin/env node
// Thin wrapper so this demo can be re-pointed at a rebuilt cdk-terrain PR worktree.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const repo = process.env.CDKTN_REPO || '../../../cdk-terrain';
const cli = path.join(repo, 'packages/cdktn-cli/bundle/bin/cdktn.js');
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status ?? 1);
