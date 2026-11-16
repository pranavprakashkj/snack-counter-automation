/** Prints the scripted demo month to the terminal. Run: npm run demo (or npm run demo:web for the browser view) */

import { runDemo } from "./demoScript.ts";
import { renderReport } from "./report.ts";

const { steps, report } = await runDemo();
for (const s of steps) {
  console.log(`\n▶ ${s.title}  [${s.at.toISOString()}]`);
  for (const n of s.notes) console.log(`   · ${n}`);
  for (const m of s.messages) console.log(`   ${m.kind === "direct" ? `@${m.to}` : `#${m.to}`}: ${m.text}`);
}
console.log(`\n${renderReport(report)}`);
