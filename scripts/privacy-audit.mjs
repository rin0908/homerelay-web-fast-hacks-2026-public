import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const root = await fs.realpath(process.cwd());
const safeRoot = root.replaceAll("\\", "/");
const gitOutput = execFileSync(
  "git",
  [
    "-c",
    `safe.directory=${safeRoot}`,
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ],
  { cwd: root, encoding: "utf8" },
);
const repositoryFiles = gitOutput.split("\0").filter(Boolean);

const approvedMedia = new Map([
  [
    "public/demo/synthetic-meal.png",
    "fcc63fd7be97740de277a68fcdb5d1fa4ee2e2d460eafd2e6a80925d166f9d44",
  ],
  [
    "tests/fixtures/fake-camera.y4m",
    "2052279d8884ea7604b822a0d2019c0d7bb81cb1dcf552376349d8fd259c4349",
  ],
]);
const forbiddenMediaExtensions = new Set([
  ".aac",
  ".avif",
  ".bmp",
  ".flac",
  ".gif",
  ".heic",
  ".jpeg",
  ".jpg",
  ".log",
  ".m4a",
  ".mov",
  ".mp3",
  ".mp4",
  ".ogg",
  ".opus",
  ".png",
  ".tif",
  ".tiff",
  ".wav",
  ".webm",
  ".webp",
  ".y4m",
]);
const credentialPatterns = [
  { label: "OpenAI key", pattern: /sk-[A-Za-z0-9_-]{20,}/ },
  { label: "Supabase secret", pattern: /sb_secret_[A-Za-z0-9_-]{12,}/ },
  { label: "GitHub token", pattern: /gh[opurs]_[A-Za-z0-9]{20,}/ },
  { label: "GitHub fine-grained token", pattern: /github_pat_[A-Za-z0-9_]{20,}/ },
  { label: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
  {
    label: "private key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    label: "JWT-like token",
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
  {
    label: "server credential assignment",
    pattern:
      /(?:DD_API_KEY|DD_APP_KEY|HOMERELAY_OPENAI_VERIFY_TOKEN|NEO4J_PASSWORD|OPENAI_API_KEY|QDRANT_API_KEY|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY)[ \t]*[=:][ \t]*["']?(?!(?:example|placeholder|synthetic|test)-)[A-Za-z0-9+/_=-]{12,}/,
  },
  {
    label: "package registry token",
    pattern: /(?:_authToken|_password)[ \t]*=[ \t]*[A-Za-z0-9+/_=-]{12,}/i,
  },
];
const sensitiveFilenames = new Set([
  ".netrc",
  ".pypirc",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
]);

function fail(message) {
  throw new Error(`[privacy-audit] ${message}`);
}

function safePath(relativePath) {
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    fail("repository path escaped the HomeRelay root");
  }
  return resolved;
}

for (const relativePath of repositoryFiles) {
  const normalized = relativePath.replaceAll("\\", "/");
  const basename = path.posix.basename(normalized).toLowerCase();
  if (basename.startsWith(".env") && normalized !== ".env.example") {
    fail(`private environment file is publishable: ${normalized}`);
  }
  if (sensitiveFilenames.has(basename) || [".key", ".pem", ".p12", ".pfx"].includes(path.posix.extname(basename))) {
    fail(`private credential file is publishable: ${normalized}`);
  }
  if (
    /(?:^|\/)(?:recordings|captures|uploads)(?:\/|$)/i.test(normalized)
  ) {
    fail(`private generated-media directory is publishable: ${normalized}`);
  }

  const extension = path.posix.extname(normalized).toLowerCase();
  if (forbiddenMediaExtensions.has(extension) && !approvedMedia.has(normalized)) {
    fail(`unapproved media/log file is publishable: ${normalized}`);
  }

  const filePath = safePath(normalized);
  const stat = await fs.lstat(filePath);
  if (stat.isSymbolicLink()) {
    fail(`symbolic links are not publishable: ${normalized}`);
  }
  const realFilePath = await fs.realpath(filePath);
  if (realFilePath !== root && !realFilePath.startsWith(`${root}${path.sep}`)) {
    fail(`repository file resolved outside the HomeRelay root: ${normalized}`);
  }
  if (!stat.isFile()) continue;

  const bytes = await fs.readFile(filePath);
  const expectedHash = approvedMedia.get(normalized);
  if (expectedHash) {
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== expectedHash) {
      fail(`approved synthetic fixture hash changed: ${normalized}`);
    }
  }
  const content = bytes.toString("utf8");
  const credential = credentialPatterns.find(({ pattern }) => pattern.test(content));
  if (credential) {
    fail(`${credential.label} found in ${normalized}`);
  }
  if (
    /^(?:app|components|lib)\//.test(normalized) &&
    /console\.(?:debug|error|info|log|warn)\s*\(/.test(content)
  ) {
    fail(`runtime console output is not allowed in ${normalized}`);
  }
}

const reachableHistory = execFileSync(
  "git",
  [
    "-c",
    `safe.directory=${safeRoot}`,
    "log",
    "--all",
    "--format=commit:%H",
    "--patch",
    "--no-ext-diff",
    "--no-color",
  ],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
const historicalCredential = credentialPatterns.find(({ pattern }) =>
  pattern.test(reachableHistory),
);
if (historicalCredential) {
  fail(`${historicalCredential.label} found in reachable Git history`);
}

const buildIdPath = path.join(root, ".next", "BUILD_ID");
let buildStat;
try {
  buildStat = await fs.stat(buildIdPath);
} catch {
  fail("fresh production build is required before the client-bundle scan");
}
const buildInputs = repositoryFiles.filter((relativePath) =>
  /^(?:app|components|lib|public|scripts)\//.test(relativePath.replaceAll("\\", "/")) ||
  [
    ".env.example",
    "next.config.ts",
    "package-lock.json",
    "package.json",
    "postcss.config.mjs",
    "proxy.ts",
    "tsconfig.json",
  ].includes(relativePath.replaceAll("\\", "/")),
);
for (const relativePath of buildInputs) {
  const inputStat = await fs.stat(safePath(relativePath));
  if (inputStat.mtimeMs > buildStat.mtimeMs) {
    fail(`production build is stale after ${relativePath}; run npm run build again`);
  }
}

const staticRoot = path.join(root, ".next", "static");
const browserFiles = [];
async function collectFiles(directory, predicate) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectFiles(fullPath, predicate);
    else if (entry.isFile() && predicate(fullPath)) browserFiles.push(fullPath);
  }
}
await collectFiles(staticRoot, () => true);
const serverAppRoot = path.join(root, ".next", "server", "app");
await collectFiles(serverAppRoot, (filePath) =>
  [".body", ".html", ".rsc", ".txt"].includes(path.extname(filePath).toLowerCase()),
);

const serverOnlyMarkers = [
  "DATADOG_API_KEY",
  "DD_API_KEY",
  "DD_APP_KEY",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "HOMERELAY_OPENAI_VERIFY_TOKEN",
  "NEO4J_PASSWORD",
  "OPENAI_API_KEY",
  "QDRANT_API_KEY",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];
const configuredSecretValues = serverOnlyMarkers
  .map((name) => process.env[name])
  .filter((value) => typeof value === "string" && value.length >= 8);

for (const bundlePath of browserFiles) {
  const content = await fs.readFile(bundlePath, "utf8");
  if (
    bundlePath.startsWith(staticRoot) &&
    serverOnlyMarkers.some((marker) => content.includes(marker))
  ) {
    fail(`server-only environment marker found in client bundle ${path.basename(bundlePath)}`);
  }
  if (configuredSecretValues.some((value) => content.includes(value))) {
    fail(`configured secret value found in client bundle ${path.basename(bundlePath)}`);
  }
}

console.log(
  `[privacy-audit] PASS ${repositoryFiles.length} publishable files; reachable Git history; ${browserFiles.length} browser-delivered build files; approved synthetic fixtures match; no private media, credential pattern, runtime content log, or server secret marker.`,
);
