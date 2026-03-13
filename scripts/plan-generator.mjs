#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_MODEL = (process.env.OPENAI_MODEL_DEFAULT || "gpt-5.2").trim();
const DEFAULT_OUTPUT = "output/plan.md";
const DEFAULT_UI_OUTPUT = "output/ui-review.md";
const DEFAULT_CAPTURE_DIR = "output/ui-captures";
const DEFAULT_MAX_IMAGES = 8;

const ICP_SYSTEM_PROMPT = [
  "You are an ICP strategist for early-stage SaaS founders.",
  "Return markdown only.",
  "Be strict and concise.",
  "Prioritize customer pain, proof of value, and feature cuts.",
  "",
  "Output sections:",
  "## ICP",
  "## Jobs To Be Done",
  "## Pain Points",
  "## Must-Have Features",
  "## Not Now (Explicit Cuts)",
  "## Success Metric",
  "## Risks To Validate First",
].join("\n");

const UX_SYSTEM_PROMPT = [
  "You are a senior SaaS product designer.",
  "You receive an ICP strategy and convert it into a build-ready UX spec.",
  "Return markdown only.",
  "Favor simple flows over feature depth.",
  "",
  "Output sections:",
  "## UX North Star",
  "## Main User Flow",
  "## Screens (max 6)",
  "For each screen include: goal, key components, required states.",
  "## UX Rules",
  "## Copy Tone",
  "## Edge Cases",
].join("\n");

const CRITIC_SYSTEM_PROMPT = [
  "You are a product critic focused on MVP clarity.",
  "You are reviewing ICP + UX drafts.",
  "Cut scope aggressively if needed.",
  "Return the final build-ready markdown spec only.",
  "",
  "Output sections:",
  "# Product Plan",
  "## Product Thesis",
  "## ICP",
  "## Core Job",
  "## Main Flow",
  "## Screens",
  "## UX Rules",
  "## Non-Goals",
  "## Success Metric",
  "## Build Handoff Notes",
].join("\n");

const UI_REVIEW_SYSTEM_PROMPT = [
  "You are a UX reviewer auditing an existing UI against the product plan.",
  "You receive screenshots and should be specific.",
  "Return markdown only.",
  "",
  "Output sections:",
  "# UI Review",
  "## Fit Score (0-10)",
  "## What Works",
  "## Gaps vs ICP and Core Job",
  "## Screen-by-Screen Feedback",
  "## Top 5 Fixes (highest leverage first)",
].join("\n");

function usage() {
  return [
    "Usage:",
    "  node scripts/plan-generator.mjs --idea \"your idea\" [options]",
    "  node scripts/plan-generator.mjs --brief ./brief.md [options]",
    "",
    "Options:",
    "  --idea <text>            Product idea or problem statement",
    "  --brief <path>           Path to a markdown/text brief",
    "  --model <name>           Model name (default: OPENAI_MODEL_DEFAULT or gpt-5.2)",
    "  --output <path>          Final plan output path (default: output/plan.md)",
    "  --screens <dir>          Directory of screenshots for UI review (optional)",
    "  --base-url <url>         App URL for auto-capturing screenshots (optional)",
    "  --routes <csv>           Routes to capture, ex: \"/,/pricing,/settings\"",
    "  --route <path>           Repeatable route flag, ex: --route / --route /logic",
    "  --capture-dir <path>     Capture directory (default: output/ui-captures)",
    "  --ui-output <path>       UI review output path (default: output/ui-review.md)",
    "  --max-images <number>    Max images sent to model for UI review (default: 8)",
    "  --help                   Show this help",
    "",
    "Notes:",
    "  - Requires OPENAI_API_KEY.",
    "  - Writes intermediate drafts next to the final output as *.icp.md and *.ux.md.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    routes: [],
    output: DEFAULT_OUTPUT,
    uiOutput: DEFAULT_UI_OUTPUT,
    captureDir: DEFAULT_CAPTURE_DIR,
    maxImages: DEFAULT_MAX_IMAGES,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const hasInline = inlineValue !== undefined;
    const maybeValue = hasInline ? inlineValue : argv[i + 1];
    const takeValue = () => {
      if (hasInline) return inlineValue;
      if (!maybeValue || maybeValue.startsWith("--")) {
        throw new Error(`Missing value for --${rawKey}`);
      }
      i += 1;
      return maybeValue;
    };

    switch (rawKey) {
      case "help":
        options.help = true;
        break;
      case "idea":
        options.idea = takeValue();
        break;
      case "brief":
        options.briefPath = takeValue();
        break;
      case "model":
        options.model = takeValue();
        break;
      case "output":
        options.output = takeValue();
        break;
      case "screens":
        options.screensDir = takeValue();
        break;
      case "base-url":
        options.baseUrl = takeValue();
        break;
      case "routes":
        options.routes.push(...splitCsv(takeValue()));
        break;
      case "route":
        options.routes.push(takeValue());
        break;
      case "capture-dir":
        options.captureDir = takeValue();
        break;
      case "ui-output":
        options.uiOutput = takeValue();
        break;
      case "max-images": {
        const parsed = Number.parseInt(takeValue(), 10);
        if (!Number.isFinite(parsed) || parsed < 1) {
          throw new Error("--max-images must be a positive integer");
        }
        options.maxImages = parsed;
        break;
      }
      default:
        throw new Error(`Unknown flag: --${rawKey}`);
    }
  }

  return options;
}

function splitCsv(value) {
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolvePath(inputPath) {
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath);
}

async function ensureParentDirectory(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

function sidecarPath(mainPath, suffix) {
  const parsed = path.parse(mainPath);
  return path.join(parsed.dir, `${parsed.name}.${suffix}.md`);
}

function slugifyRoute(route) {
  const clean = route.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!clean) return "home";
  return clean.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return null;
}

async function toDataUrl(filePath) {
  const mime = mimeFromPath(filePath);
  if (!mime) throw new Error(`Unsupported image type: ${filePath}`);
  const data = await readFile(filePath);
  return `data:${mime};base64,${data.toString("base64")}`;
}

async function listImageFiles(rootDir) {
  const files = [];
  const pending = [resolvePath(rootDir)];
  while (pending.length) {
    const current = pending.pop();
    if (!current) continue;
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (mimeFromPath(fullPath)) files.push(fullPath);
    }
  }
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

async function callAgent({
  apiKey,
  model,
  systemPrompt,
  userInput,
  maxOutputTokens = 2600,
  imagePaths = [],
}) {
  const userContent = [{ type: "input_text", text: userInput }];
  for (const imagePath of imagePaths) {
    const dataUrl = await toDataUrl(imagePath);
    userContent.push({ type: "input_text", text: `Screenshot: ${path.basename(imagePath)}` });
    userContent.push({ type: "input_image", image_url: dataUrl });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }],
        },
        {
          role: "user",
          content: userContent,
        },
      ],
      max_output_tokens: maxOutputTokens,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    const detail = errorBody.slice(0, 600);
    throw new Error(`OpenAI API error (${response.status}): ${detail}`);
  }

  const payload = await response.json();
  const outputText = extractOutputText(payload);
  if (!outputText) {
    throw new Error("OpenAI API returned no text output.");
  }
  return outputText.trim();
}

function extractOutputText(payload) {
  if (payload && typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  const output = Array.isArray(payload?.output) ? payload.output : [];
  const chunks = [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === "string" && part.text.trim()) {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

async function captureScreenshots(baseUrl, routes, captureDir) {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    throw new Error(
      "Playwright is not available. Install with `npm run test:e2e:install` and ensure @playwright/test is installed."
    );
  }

  const normalizedBase = new URL(baseUrl).toString();
  const resolvedCaptureDir = resolvePath(captureDir);
  await mkdir(resolvedCaptureDir, { recursive: true });

  const browser = await playwright.chromium.launch({ headless: true });
  const captures = [];
  const profiles = [
    { label: "desktop", viewport: { width: 1440, height: 900 } },
    { label: "mobile", viewport: { width: 390, height: 844 } },
  ];

  try {
    for (const profile of profiles) {
      const context = await browser.newContext({ viewport: profile.viewport });
      try {
        for (let index = 0; index < routes.length; index += 1) {
          const route = routes[index];
          const url = new URL(route, normalizedBase).toString();
          const page = await context.newPage();
          try {
            await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
            await page.waitForTimeout(700);
            const fileName = `${String(index + 1).padStart(2, "0")}-${slugifyRoute(route)}-${
              profile.label
            }.png`;
            const savePath = path.join(resolvedCaptureDir, fileName);
            await page.screenshot({ path: savePath, fullPage: true });
            captures.push(savePath);
            process.stdout.write(`Captured ${url} -> ${savePath}\n`);
          } finally {
            await page.close();
          }
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  return captures;
}

async function buildInputBrief(options) {
  const sections = [];
  if (options.idea) {
    sections.push(`## Idea\n${String(options.idea).trim()}`);
  }
  if (options.briefPath) {
    const briefFilePath = resolvePath(options.briefPath);
    const briefText = (await readFile(briefFilePath, "utf8")).trim();
    if (briefText) {
      sections.push(`## Existing Brief (${briefFilePath})\n${briefText}`);
    }
  }
  return sections.join("\n\n").trim();
}

async function writeMarkdown(filePath, content) {
  const resolved = resolvePath(filePath);
  await ensureParentDirectory(resolved);
  await writeFile(resolved, content, "utf8");
  return resolved;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const inputBrief = await buildInputBrief(options);
  if (!inputBrief) {
    throw new Error("Provide at least one of --idea or --brief.");
  }

  const model = (options.model || DEFAULT_MODEL).trim();
  process.stdout.write(`Model: ${model}\n`);

  process.stdout.write("Running ICP pass...\n");
  const icpOutput = await callAgent({
    apiKey,
    model,
    systemPrompt: ICP_SYSTEM_PROMPT,
    userInput: inputBrief,
    maxOutputTokens: 1800,
  });

  process.stdout.write("Running UX pass...\n");
  const uxOutput = await callAgent({
    apiKey,
    model,
    systemPrompt: UX_SYSTEM_PROMPT,
    userInput: [
      "Use this ICP strategy and produce a clean product UX spec.",
      "",
      icpOutput,
    ].join("\n"),
    maxOutputTokens: 2200,
  });

  process.stdout.write("Running Critic pass...\n");
  const finalPlan = await callAgent({
    apiKey,
    model,
    systemPrompt: CRITIC_SYSTEM_PROMPT,
    userInput: [
      "Original input:",
      inputBrief,
      "",
      "ICP draft:",
      icpOutput,
      "",
      "UX draft:",
      uxOutput,
    ].join("\n"),
    maxOutputTokens: 2600,
  });

  const outputPath = resolvePath(options.output || DEFAULT_OUTPUT);
  const icpPath = sidecarPath(outputPath, "icp");
  const uxPath = sidecarPath(outputPath, "ux");
  const finalPath = await writeMarkdown(outputPath, finalPlan);
  const savedIcpPath = await writeMarkdown(icpPath, icpOutput);
  const savedUxPath = await writeMarkdown(uxPath, uxOutput);

  process.stdout.write(`Saved final plan: ${finalPath}\n`);
  process.stdout.write(`Saved ICP draft: ${savedIcpPath}\n`);
  process.stdout.write(`Saved UX draft: ${savedUxPath}\n`);

  const reviewImagePaths = [];
  const requestedRoutes = options.routes.length ? options.routes : options.baseUrl ? ["/"] : [];
  if (options.baseUrl && requestedRoutes.length) {
    process.stdout.write("Capturing screenshots with Playwright...\n");
    const captured = await captureScreenshots(options.baseUrl, requestedRoutes, options.captureDir);
    reviewImagePaths.push(...captured);
  }
  if (options.screensDir) {
    const fromDir = await listImageFiles(options.screensDir);
    reviewImagePaths.push(...fromDir);
  }

  const uniqueImages = Array.from(new Set(reviewImagePaths)).slice(0, options.maxImages);
  if (uniqueImages.length > 0) {
    process.stdout.write(`Running UI review with ${uniqueImages.length} screenshot(s)...\n`);
    const uiReview = await callAgent({
      apiKey,
      model,
      systemPrompt: UI_REVIEW_SYSTEM_PROMPT,
      userInput: [
        "Evaluate the existing UI against this product plan.",
        "Focus on ICP alignment, clarity, and conversion to first value.",
        "",
        finalPlan,
      ].join("\n"),
      imagePaths: uniqueImages,
      maxOutputTokens: 2200,
    });
    const uiPath = await writeMarkdown(options.uiOutput || DEFAULT_UI_OUTPUT, uiReview);
    process.stdout.write(`Saved UI review: ${uiPath}\n`);
  } else {
    process.stdout.write("No screenshots supplied. UI review skipped.\n");
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 1;
});
