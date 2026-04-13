import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const extraArgs = process.argv.slice(2);
const command = isWindows ? "cmd.exe" : "pnpm";
const args = isWindows
  ? [
      "/d",
      "/s",
      "/c",
      ["pnpm", "exec", "vitest", "run", "server/tests/duckai.live.test.ts", "--reporter=verbose", ...extraArgs].join(
        " ",
      ),
    ]
  : ["exec", "vitest", "run", "server/tests/duckai.live.test.ts", "--reporter=verbose", ...extraArgs];

const child = spawn(command, args, {
  env: {
    ...process.env,
    RUN_DUCKAI_LIVE: "1",
  },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
