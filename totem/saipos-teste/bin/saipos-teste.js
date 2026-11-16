#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { principal } from "../src/cli.js";

const pacoteDir = join(dirname(fileURLToPath(import.meta.url)), "..");
process.exitCode = await principal(process.argv.slice(2), { pacoteDir });
