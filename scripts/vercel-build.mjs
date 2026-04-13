import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shouldRunMigrations = process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "production";

function run(command, args, { optional = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: process.env,
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  if (result.status !== 0) {
    if (optional) {
      console.warn(`[vercel-build] Command "${command} ${args.join(" ")}" failed (exit ${result.status}), continuing...`);
      return false;
    }
    process.exit(result.status ?? 1);
  }
  return true;
}

run("pnpm", ["prisma:generate"]);

if (shouldRunMigrations) {
  console.log(`[vercel-build] Running migrations for VERCEL_ENV=${process.env.VERCEL_ENV}`);
  const ok = run("pnpm", ["prisma:migrate:deploy"], { optional: true });
  if (!ok) {
    console.warn("[vercel-build] Migration failed (likely advisory lock timeout). Retrying once...");
    run("pnpm", ["prisma:migrate:deploy"]);
  }
} else {
  console.log("[vercel-build] Skipping prisma migrate deploy outside Vercel preview/production.");
}

run("pnpm", ["build"]);
