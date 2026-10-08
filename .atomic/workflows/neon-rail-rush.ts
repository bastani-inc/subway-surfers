import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { workflow } from "@bastani/atomic/workflows";
import { Type } from "typebox";
import { ASSETS, SUPPORT_DIR, generateConcept, imageTo3d, run } from "./neon-rail-rush/assets.js";
import {
  MODEL_SLICES,
  PLACEHOLDER_SLICES,
  type SliceSpec,
  acceptancePrompt,
  assetReviewPrompt,
  blenderPrompt,
  conceptReviewPrompt,
  implementPrompt,
  repairPrompt,
  reviewPrompt,
  rigPrompt,
} from "./neon-rail-rush/prompts.js";

const ReviewVerdict = Type.Object({
  approved: Type.Boolean({ description: "True only when every acceptance criterion is met with real evidence." }),
  findings: Type.Array(Type.String(), { description: "Concrete actionable defects; empty when approved." }),
});

const ConceptVerdict = Type.Object({
  regenerate: Type.Array(
    Type.Object({ id: Type.String(), correction: Type.String({ description: "One-sentence prompt correction." }) }),
    { description: "Concept images that must be regenerated; empty when all are usable." },
  ),
});

const AcceptanceVerdict = Type.Object({
  accepted: Type.Boolean(),
  failed_criteria: Type.Array(Type.String()),
});

type Verdict = { approved: boolean; findings: string[] };
type SliceOutcome = { ok: true } | { ok: false; slice: string; reason: string };

export default workflow({
  name: "neon-rail-rush",
  description:
    "Build Neon Rail Rush, an original three-lane endless runner: gpt-image-2.5-flare concept art → Hunyuan3D-2.1 meshes → Blender cleanup and mocap rig → Three.js game, promoting only verified builds to a live Chrome preview.",
  inputs: {
    live_port: Type.Integer({ default: 5199, description: "Port for the live preview server that shows only verified builds." }),
    max_repairs: Type.Integer({ default: 3, description: "Repair rounds per slice before the workflow stops at that slice." }),
  },
  outputs: {
    status: Type.String(),
    summary: Type.String(),
    live_url: Type.String(),
  },
  run: async (ctx) => {
    const cwd = ctx.cwd ?? process.cwd();
    const liveDir = join(cwd, "live");
    const liveUrl = `http://127.0.0.1:${ctx.inputs.live_port}`;
    const runId = ctx.runId ?? "local";

    // 1. Open the live preview on the user's screen. It shows only promoted (verified) builds.
    await ctx.tool("open-live-preview", { liveDir, port: ctx.inputs.live_port }, async ({ signal }) => {
      await mkdir(liveDir, { recursive: true });
      const alreadyServing = await fetch(`${liveUrl}/__version`, { signal }).then((r) => r.ok).catch(() => false);
      if (!alreadyServing) {
        await writeFile(
          join(liveDir, "index.html"),
          `<!doctype html><html><body style="margin:0;background:#0b0618;color:#5ef2ff;font:600 28px system-ui;display:grid;place-items:center;height:100vh">Neon Rail Rush — waiting for the first verified build…</body></html>`,
        );
        await writeFile(join(liveDir, "version.txt"), "placeholder");
        const server = spawn("node", [join(SUPPORT_DIR, "live-server.mjs"), liveDir, String(ctx.inputs.live_port)], {
          detached: true,
          stdio: "ignore",
        });
        server.unref();
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      await run("open", ["-a", "Google Chrome", liveUrl], cwd, signal);
      return { liveUrl, started: !alreadyServing };
    }, { timeoutMs: 30_000 });

    // 2. Asset pipeline and placeholder game slices run concurrently on disjoint directories.
    const [assets, placeholderSlices] = await Promise.all([buildAssets(), buildSlices(PLACEHOLDER_SLICES, false)]);
    if (!placeholderSlices.ok) return blocked(placeholderSlices.slice, placeholderSlices.reason);
    if (!assets.approved) {
      return blocked("assets", `asset review still failing: ${assets.findings.join("; ")}`);
    }

    // 3. Model integration and the city, stacked on the verified placeholder game.
    const modelSlices = await buildSlices(MODEL_SLICES, true);
    if (!modelSlices.ok) return blocked(modelSlices.slice, modelSlices.reason);

    // 4. Final acceptance against the live build.
    const acceptance = await ctx.task("final-acceptance", {
      prompt: acceptancePrompt(liveUrl),
      schema: AcceptanceVerdict,
      context: "fresh",
      output: "docs/acceptance-report.md",
    });
    const verdict = acceptance.structured as { accepted: boolean; failed_criteria: string[] };
    await commit("final acceptance report", true, [
      `Assistant-verification: agent-browser E2E ${verdict.accepted ? "passed" : "failed"}: full brief acceptance on ${liveUrl}`,
    ]);
    return verdict.accepted
      ? { status: "completed", summary: "Neon Rail Rush built, verified, and live.", live_url: liveUrl }
      : { status: "incomplete", summary: `Acceptance failed: ${verdict.failed_criteria.join("; ")}`, live_url: liveUrl };

    function blocked(slice: string, reason: string) {
      return { status: "blocked", summary: `Stopped at ${slice}: ${reason}`, live_url: liveUrl };
    }

    // Asset pipeline: concept art → review → 3D meshes → Blender cleanup → rig → review (one repair round).
    async function buildAssets(): Promise<Verdict> {
      const conceptPath = (id: string) => join(cwd, "assets", "concept", `${id}.png`);
      await Promise.all(
        ASSETS.map((asset) =>
          ctx.tool(`concept:${asset.id}`, { id: asset.id }, ({ signal }) => generateConcept(asset, conceptPath(asset.id), signal), {
            timeoutMs: 6 * 60_000,
            retriesAllowed: true,
            maxAttempts: 3,
            intervalMs: 5_000,
          }),
        ),
      );

      const conceptReview = await ctx.task("review-concept-art", {
        prompt: conceptReviewPrompt(ASSETS.map((asset) => `assets/concept/${asset.id}.png`)),
        schema: ConceptVerdict,
        context: "fresh",
      });
      const redo = (conceptReview.structured as { regenerate: { id: string; correction: string }[] }).regenerate;
      for (const { id, correction } of redo) {
        const asset = ASSETS.find((candidate) => candidate.id === id);
        if (!asset) continue;
        await ctx.tool(`concept-retry:${id}`, { id, correction }, ({ signal }) => generateConcept(asset, conceptPath(id), signal, correction), {
          timeoutMs: 6 * 60_000,
          retriesAllowed: true,
          maxAttempts: 3,
        });
      }

      const meshReport: string[] = [];
      const queue = ASSETS.filter((asset) => asset.to3d);
      const meshWorker = async () => {
        for (let asset = queue.shift(); asset; asset = queue.shift()) {
          const id = asset.id;
          const outcome = await ctx.tool(
            `mesh:${id}`,
            { id },
            ({ signal }) => imageTo3d(conceptPath(id), join(cwd, "assets", "raw", `${id}.glb`), signal),
            { timeoutMs: 20 * 60_000, retriesAllowed: true, maxAttempts: 3, intervalMs: 60_000, failureMode: "return" },
          );
          meshReport.push(outcome.ok ? `- ${id}: assets/raw/${id}.glb (${outcome.value.log.trim().split("\n").pop()})` : `- ${id}: FAILED (${outcome.error.message.slice(0, 300)})`);
        }
      };
      await Promise.all([meshWorker(), meshWorker()]);

      await ctx.task("blender-cleanup", { prompt: blenderPrompt(meshReport.sort().join("\n")), context: "fresh" });
      await ctx.task("rig-runner-mocap", { prompt: rigPrompt(), context: "fresh" });

      let verdict = await reviewAssets(1);
      if (!verdict.approved) {
        await ctx.task("asset-repair", {
          prompt: `${blenderPrompt(meshReport.join("\n"))}\n\nThis is a repair pass. Fix only these review findings (re-run the rig step's verification if you touch the runner):\n- ${verdict.findings.join("\n- ")}`,
          context: "fresh",
        });
        verdict = await reviewAssets(2);
      }
      return verdict;
    }

    async function reviewAssets(round: number): Promise<Verdict> {
      const review = await ctx.task(`review-assets-${round}`, { prompt: assetReviewPrompt(), schema: ReviewVerdict, context: "fresh" });
      return review.structured as Verdict;
    }

    // Stacked slices, each: implement → (check gate → review → repair)* → promote → commit. Unrolled, so the graph stays a DAG.
    async function buildSlices(slices: readonly SliceSpec[], includeAssets: boolean): Promise<SliceOutcome> {
      for (const slice of slices) {
        await ctx.task(`implement-${slice.id}`, { prompt: implementPrompt(slice), context: "fresh" });
        let lastProblem = "";
        let verified = false;
        for (let attempt = 1; attempt <= ctx.inputs.max_repairs + 1 && !verified; attempt++) {
          if (attempt > 1) {
            await ctx.task(`repair-${slice.id}-${attempt - 1}`, { prompt: repairPrompt(slice, lastProblem), context: "fresh" });
          }
          const gate = await ctx.tool(`check-${slice.id}-${attempt}`, { slice: slice.id, attempt }, async ({ signal }) => {
            const result = await run("npm", ["run", "check"], cwd, signal);
            if (result.code !== 0) throw new Error(`npm run check exited ${result.code}\n${result.output.slice(-4000)}`);
            return { output: result.output };
          }, { timeoutMs: 25 * 60_000, failureMode: "return" });
          if (!gate.ok) {
            lastProblem = `npm run check failed:\n${gate.error.message.slice(-4000)}`;
            continue;
          }
          const review = await ctx.task(`review-${slice.id}-${attempt}`, {
            prompt: reviewPrompt(slice, gate.value.output),
            schema: ReviewVerdict,
            context: "fresh",
          });
          const verdict = review.structured as Verdict;
          if (verdict.approved) verified = true;
          else lastProblem = `Independent review rejected the slice:\n- ${verdict.findings.join("\n- ")}`;
        }
        if (!verified) return { ok: false, slice: slice.id, reason: lastProblem.slice(0, 1500) };
        await promote(slice.id);
        await commit(`${slice.title}`, includeAssets, [
          "Assistant-verification: npm run check passed: typecheck, vitest unit, vite build, playwright e2e",
          `Assistant-verification: agent-browser review passed: independent reviewer played slice ${slice.id}`,
        ]);
      }
      return { ok: true };
    }

    async function promote(sliceId: string) {
      await ctx.tool(`promote-${sliceId}`, { sliceId }, async ({ signal }) => {
        const build = await run("npm", ["run", "build"], cwd, signal);
        if (build.code !== 0) throw new Error(`build failed during promotion:\n${build.output}`);
        await rm(liveDir, { recursive: true, force: true });
        await cp(join(cwd, "dist"), liveDir, { recursive: true });
        const version = `${sliceId}-${Date.now()}`;
        await writeFile(join(liveDir, "version.txt"), version);
        return { version };
      }, { timeoutMs: 10 * 60_000 });
    }

    async function commit(subject: string, includeAssets: boolean, verification: readonly string[]) {
      await ctx.tool(`commit:${subject}`, { subject, includeAssets }, async ({ signal }) => {
        const gitignorePath = join(cwd, ".gitignore");
        const existing = await readFile(gitignorePath, "utf8").catch(() => "");
        const required = ["node_modules", "dist", "live", "test-results", "playwright-report", "assets/raw"];
        const missing = required.filter((entry) => !existing.split("\n").includes(entry));
        if (missing.length) await writeFile(gitignorePath, `${existing.trimEnd()}\n${missing.join("\n")}\n`.trimStart());
        const pathspec = includeAssets ? ["."] : [".", ":!assets", ":!public/models"];
        await run("git", ["add", "-A", "--", ...pathspec], cwd, signal);
        const message = [
          `feat: ${subject}`,
          "",
          "Assistant-model: Claude Opus 5.5",
          `Assistant-workflow: neon-rail-rush (run ${runId})`,
          ...verification,
          "Co-authored-by: Alex Lavaee <lavaalex3@gmail.com>",
        ].join("\n");
        const result = await run("git", ["commit", "--allow-empty", "-m", message], cwd, signal);
        if (result.code !== 0) throw new Error(result.output);
        const push = await run("git", ["push", "-u", "origin", "HEAD"], cwd, signal);
        if (push.code !== 0) throw new Error(`push failed: ${push.output}`);
        return { committed: true };
      }, { timeoutMs: 60_000 });
    }
  },
});

