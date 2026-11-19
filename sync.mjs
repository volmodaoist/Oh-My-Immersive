#!/usr/bin/env node
// Explicit vault paths replace the upstream maintainer's workstation targets.
import { main } from "./scripts/install.mjs";
await main().catch(error => { console.error(error.message); process.exitCode = 1; });
