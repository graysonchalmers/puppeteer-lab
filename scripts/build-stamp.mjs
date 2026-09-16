// scripts/build-stamp.mjs
// Build-time generator: resolves the commit sha+date, derives the stamp, and
// writes build-stamp.json at the repo root. Runs as a prebuild step (Task 4).
// A packaged app has no git, so the stamp is baked here, never at runtime.
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deriveStamp } from './build-stamp/derive.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function pkgVersion() {
  try { return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version || ''; }
  catch { return ''; }
}

function resolve() {
  const sha = process.env.BUILD_STAMP_SHA || git(['rev-parse', 'HEAD']);
  const date = process.env.BUILD_STAMP_DATE
    || git(['show', '-s', '--format=%cd', '--date=short', 'HEAD']);
  const version = process.env.BUILD_STAMP_VERSION || pkgVersion();
  return deriveStamp(sha, date, version);
}

const stamp = resolve();
if (process.argv.includes('--print')) {
  process.stdout.write(stamp.stamp + '\n');
} else {
  writeFileSync(join(root, 'build-stamp.json'), JSON.stringify(stamp, null, 2) + '\n');
  console.log('[build-stamp]', stamp.stamp);
}
