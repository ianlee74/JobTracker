// Imports jobs from the daily tracker HTML files produced by the Claude Cowork
// job (which embed a `const ORIGINAL_JOBS = [...]` array) into the database.
//
// Usage: node scripts/import-html.mjs <file-or-directory> [...more]
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { addJobs, DB_PATH } from '../server/db.js';

const args = process.argv.slice(2);
if (!args.length) {
  console.error('Usage: node scripts/import-html.mjs <tracker.html | directory> [...more]');
  process.exit(1);
}

async function expand(target) {
  const s = await stat(target);
  if (s.isDirectory()) {
    const entries = await readdir(target);
    return entries.filter(f => f.toLowerCase().endsWith('.html')).map(f => path.join(target, f));
  }
  return [target];
}

let totalAdded = 0;
let totalSkipped = 0;

for (const target of args) {
  for (const file of await expand(target)) {
    const html = await readFile(file, 'utf8');
    const match = html.match(/const ORIGINAL_JOBS = (\[.*?\]);\n/s);
    if (!match) {
      console.warn(`No ORIGINAL_JOBS data found in ${file} — skipping`);
      continue;
    }
    let jobs;
    try {
      jobs = JSON.parse(match[1]);
    } catch (err) {
      console.warn(`Could not parse job data in ${file}: ${err.message}`);
      continue;
    }
    const { added, skipped } = addJobs(jobs);
    totalAdded += added;
    totalSkipped += skipped;
    console.log(`${path.basename(file)}: ${added} added, ${skipped} already tracked`);
  }
}

console.log(`\nDone. ${totalAdded} added, ${totalSkipped} skipped. Database: ${DB_PATH}`);
