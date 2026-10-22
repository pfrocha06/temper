#!/usr/bin/env node
// Scripted stand-in for the `claude` CLI. Behaviour depends on the role named in the prompt.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
const say = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const sh = (...a) => execFileSync(a[0], a.slice(1), { stdio: "ignore" });
say({ type: "system", subtype: "init", session_id: "fake-session", model: "fake" });

let text;
if (prompt.includes("You are the builder")) {
  if (prompt.includes("Feedback from the previous attempt")) {
    writeFileSync("hello.txt", "hello\n");
    sh("git", "add", "-A");
    sh("git", "commit", "-q", "-m", "add hello");
    text = "Added hello.txt\nVERDICT: PASS";
  } else {
    text = "I think I am done.\nVERDICT: PASS"; // forgot to commit: the gate must catch it
  }
} else if (prompt.includes("You are the verifier")) {
  writeFileSync("check.sh", "test -f \"$TEMPER_CANDIDATE_PATH/hello.txt\" && echo 'AC-1: PASS' || echo 'AC-1: FAIL hello missing'\n");
  text = "AC-1: PASS\nVERDICT: PASS";
} else if (prompt.includes("You are the reviewer")) {
  text = "No blockers.\nVERDICT: PASS";
} else {
  text = "VERDICT: FAIL";
}
say({ type: "assistant", message: { content: [{ type: "text", text }] } });
say({ type: "result", subtype: "success", is_error: false, result: text, num_turns: 1, session_id: "fake-session" });
