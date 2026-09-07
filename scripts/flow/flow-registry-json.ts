#!/usr/bin/env tsx
import { listFlows } from './flow-registry.js';

process.stdout.write(JSON.stringify(listFlows()));
