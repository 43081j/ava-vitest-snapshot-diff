#!/usr/bin/env node

import { runCLI } from './main.js';

runCLI().catch((error) => {
  console.error('Error running CLI:', error);
  process.exit(1);
});
