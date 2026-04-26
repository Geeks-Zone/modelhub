#!/usr/bin/env node

import { runStandaloneCli } from '../src/index.mjs';

try {
  await runStandaloneCli();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
