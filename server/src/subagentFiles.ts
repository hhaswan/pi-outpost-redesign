/**
 * pi-subagents agent files, managed from the browser.
 *
 * Discovery and skill resolution mirror the installed @tintinweb/pi-subagents 0.25
 * (`custom-agents.ts`, `skill-loader.ts`, `package-resources.ts`), so the panel shows what
 * the package loads. Writes are confined to two directories and addressed by scope and
 * file name; the client never sends a path. Edits rewrite only the frontmatter key blocks
 * the user changed, so unknown keys, comments, order and line endings survive.
 */
import { createHash, randomUUID } from "node:crypto";
import * as nodeFs from "node:fs";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type {
  SubagentChanges, SubagentEntry, SubagentManagementData, SubagentManagementOperation, SubagentManagementReply,
  SubagentScope, SubagentSkillInfo, SubagentSkills, SubagentSource,
} from "@pi-outpost/shared";
import { packageManagerFor } from "./piPackages.ts";
import { subagentRpc } from "./subagentActivity.ts";

export const SUBAGENTS_PACKAGE = "@tintinweb/pi-subagents";
const MAX_FILE_BYTES = 1_048_576;
const THINKING = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
/** Keys the panel edits; every other key is preserved and shown read-only. */
const EDITED_KEYS = new Set(["name", "description", "enabled", "color", "skills", "inherit_skills", "tools", "model", "thinking", "prompt_mode"]);

/** pi-subagents' `isUnsafeName` (memory.ts): the rule its loader applies to skill and memory names. */
export function isUnsafeName(name: string): boolean {
  return !name || name.length > 128 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name);
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// ---- Frontmatter key-block editing -------------------------------------------------

interface Doc { lines: string[]; close: number; eol: string }

/**
 * Lines with their terminators, and the closing fence. The fences agree with pi's parser:
 * the file (past a BOM) opens with `---` and the block closes at the next line starting
 * `---`. `close` is -1 when there is no frontmatter block.
 */
function splitDoc(content: string): Doc {
  const lines = content.split(/(?<=\n)/);
  const eol = lines[0]?.endsWith("\r\n") ? "\r\n" : "\n";
  const first = (lines[0] ?? "").replace(/^\uFEFF/, "").replace(/\r?\n$/, "");
  if (!/^---[ \t]*$/.test(first)) return { lines, close: -1, eol };
  const close = lines.findIndex((line, i) => i > 0 && line.startsWith("---"));
  return { lines, close, eol };
}

const KEY_LINE = /^([A-Za-z_][\w.-]*)[ \t]*:(?=[ \t]|\r?\n|$)/;

/** Top-level key blocks: the key line and the indented lines under it. */
function keyBlocks(doc: Doc): Array<{ key: string; start: number; end: number }> {
  const blocks: Array<{ key: string; start: number; end: number }> = [];
  for (let i = 1; i < doc.close; i++) {
    const key = KEY_LINE.exec(doc.lines[i])?.[1];
    if (!key) continue;
    let end = i + 1;
    while (end < doc.close && /^[ \t]/.test(doc.lines[end])) end++;
    blocks.push({ key, start: i, end });
  }
  return blocks;
}

/** A YAML scalar that pi's parser reads back as exactly `value`: plain when that works, else double-quoted. */
export function yamlScalar(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error("Values must be one line");
  const readsBack = (raw: string) => {
    try { return parseFrontmatter<Record<string, unknown>>(`---\nk: ${raw}\n---\n`).frontmatter.k === value; } catch { return false; }
  };
  if (value.trim() === value && value !== "" && readsBack(value)) return value;
  const quoted = JSON.stringify(value);
  if (!readsBack(quoted)) throw new Error("Value cannot be written as YAML");
  return quoted;
}

/**
 * Set (`raw` given) or remove (`raw` undefined) one top-level key, replacing only its block.
 * `aliases` are other spellings the loader reads for the same field; they are folded in.
 */
export function setFrontmatterKey(content: string, key: string, raw: string | undefined, aliases: string[] = []): string {
  let doc = splitDoc(content);
  if (doc.close === -1) {
    if (raw === undefined) return content;
    const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
    const eol = content.includes("\r\n") ? "\r\n" : "\n";
    content = `${bom}---${eol}---${eol}${content.slice(bom.length)}`;
    doc = splitDoc(content);
  }
  const names = [key, ...aliases];
  const blocks = keyBlocks(doc).filter((block) => names.includes(block.key));
  const target = blocks.find((block) => block.key === key) ?? blocks[0];
  const out: string[] = [];
  for (let i = 0; i < doc.lines.length; i++) {
    const block = blocks.find((entry) => entry.start === i);
    if (block) {
      if (block === target && raw !== undefined) out.push(`${key}: ${raw}${doc.eol}`);
      i = block.end - 1;
      continue;
    }
    if (i === doc.close && !target && raw !== undefined) out.push(`${key}: ${raw}${doc.eol}`);
    out.push(doc.lines[i]);
  }
  return out.join("");
}

/** The body after the closing fence, without its first line break, as the editor shows it. */
export function bodyOf(content: string): string {
  const doc = splitDoc(content);
  const rest = doc.close === -1 ? content.replace(/^\uFEFF/, "") : doc.lines.slice(doc.close + 1).join("");
  return rest.replace(/^\r?\n/, "").replace(/\r\n/g, "\n");
}

/** Replace the body, keeping the frontmatter bytes and the file's line ending. */
export function setBody(content: string, prompt: string): string {
  if (bodyOf(content) === prompt.replace(/\r\n/g, "\n")) return content;
  const doc = splitDoc(content);
  const text = prompt.replace(/\r?\n/g, doc.eol);
  const body = text === "" ? "" : `${doc.eol}${text}${text.endsWith(doc.eol) ? "" : doc.eol}`;
  if (doc.close === -1) return (content.startsWith("\uFEFF") ? "\uFEFF" : "") + body.slice(doc.eol.length);
  return doc.lines.slice(0, doc.close + 1).join("") + body;
}

/** Apply panel changes to a file's text, touching only the changed keys and the body. */
export function applyChanges(content: string, changes: SubagentChanges): string {
  let next = content;
  if (changes.description !== undefined) next = setFrontmatterKey(next, "description", yamlScalar(changes.description));
  if (changes.enabled !== undefined) next = setFrontmatterKey(next, "enabled", changes.enabled ? undefined : "false");
  if (changes.skills !== undefined) {
    const skills = changes.skills;
    if (Array.isArray(skills)) for (const skill of skills) if (isUnsafeName(skill)) throw new Error(`Invalid skill name: ${skill}`);
    const raw = skills === true ? undefined : skills === false || skills.length === 0 ? "false" : skills.join(", ");
    next = setFrontmatterKey(next, "skills", raw, ["inherit_skills"]);
  }
  if (changes.tools !== undefined) next = setFrontmatterKey(next, "tools", changes.tools === null ? undefined : yamlScalar(changes.tools.split(",").map((tool) => tool.trim()).filter(Boolean).join(", ") || "none"));
  if (changes.model !== undefined) next = setFrontmatterKey(next, "model", changes.model === null ? undefined : yamlScalar(changes.model));
  if (changes.thinking !== undefined) {
    if (changes.thinking !== null && !THINKING.has(changes.thinking)) throw new Error("Unknown thinking level");
    next = setFrontmatterKey(next, "thinking", changes.thinking ?? undefined);
  }
  if (changes.promptMode !== undefined) {
    if (changes.promptMode !== "replace" && changes.promptMode !== "append") throw new Error("Unknown prompt mode");
    next = setFrontmatterKey(next, "prompt_mode", changes.promptMode);
  }
  if (changes.prompt !== undefined) next = setBody(next, changes.prompt);
  return next;
}

// ---- Parsing for display -------------------------------------------------------------

const str = (value: unknown) => (typeof value === "string" ? value : undefined);

/** pi-subagents' `inheritField`: omitted/true all, false/"none"/empty none, CSV the names. */
function inheritField(value: unknown): SubagentSkills {
  if (value === undefined || value === null || value === true) return true;
  if (value === false || value === "none") return false;
  const items = String(value).trim() === "none" ? [] : String(value).split(",").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : false;
}

type Parsed = Omit<SubagentEntry, "source" | "active">;

export function describeAgentFile(content: string, fileName: string): Parsed {
  const base = { name: fileName, enabled: true, description: fileName, skills: true as SubagentSkills, promptMode: "replace" as const, prompt: bodyOf(content), otherFields: [] };
  let fm: Record<string, unknown>;
  try {
    fm = parseFrontmatter<Record<string, unknown>>(content.replace(/^\uFEFF/, "")).frontmatter ?? {};
  } catch (error) {
    return { ...base, error: `pi-subagents skips this file: ${error instanceof Error ? error.message : String(error)}` };
  }
  const declared = str(fm.name)?.trim();
  const name = declared || fileName;
  const value = (raw: unknown) => (typeof raw === "string" ? raw : JSON.stringify(raw) ?? String(raw));
  return {
    ...base,
    name,
    enabled: fm.enabled !== false,
    description: str(fm.description) ?? name,
    ...(str(fm.color) ? { color: str(fm.color) } : {}),
    skills: inheritField(fm.skills ?? fm.inherit_skills),
    ...(fm.tools !== undefined && fm.tools !== null ? { tools: String(fm.tools) } : {}),
    ...(str(fm.model) ? { model: str(fm.model) } : {}),
    ...(str(fm.thinking) ? { thinking: str(fm.thinking) } : {}),
    promptMode: fm.prompt_mode === "append" ? "append" : "replace",
    otherFields: Object.entries(fm).filter(([key]) => !EDITED_KEYS.has(key)).map(([key, raw]) => ({ key, value: value(raw) })),
    ...(declared?.includes(":") ? { error: `pi-subagents skips this file: name "${declared}" contains ":"` } : {}),
  };
}

// ---- Discovery -----------------------------------------------------------------------

export interface SubagentContext {
  root: string;
  agentDir: string;
  /** Home for the user-level skill roots; pi-subagents uses `os.homedir()`. */
  home?: string;
  /** Installed roots of configured pi packages, in pi's order. */
  packages?: () => Promise<string[]>;
  /** Skills the session loaded (general inventory), for disabled entries. */
  inventorySkills?: () => Array<{ name: string; path?: string }>;
  /** `embedded` or `rpc`; `sessionId` is set when the embedded runtime has started. */
  runtime: { kind: string; sessionId?: string };
}

export function scopeDir(ctx: Pick<SubagentContext, "root" | "agentDir">, scope: SubagentScope): string {
  return scope === "global" ? path.join(ctx.agentDir, "agents") : path.join(ctx.root, ".pi", "agents");
}

type Found = { entry: SubagentEntry; content?: string };

function readAgentFile(file: string, source: SubagentSource, scope?: SubagentScope, packageName?: string): Found | undefined {
  let stat;
  try { stat = statSync(file); } catch { return undefined; }
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return undefined;
  let content: string;
  try { content = readFileSync(file, "utf8"); } catch { return undefined; }
  const fileName = path.basename(file, ".md");
  const symlinked = lstatIsSymlink(file);
  const writable = scope !== undefined && !symlinked && !isUnsafeName(fileName);
  return {
    content,
    entry: {
      ...describeAgentFile(content, fileName),
      source,
      active: false,
      path: file,
      ...(packageName ? { packageName } : {}),
      ...(writable ? { scope, file: fileName, hash: contentHash(content) } : {}),
      ...(scope && symlinked ? { error: "Symlinked file: edit it at its target" } : {}),
    },
  };
}

function readAgentDir(dir: string, source: SubagentSource, scope?: SubagentScope, packageName?: string, excluded?: Set<string>): Found[] {
  let names: string[];
  try { names = readdirSync(dir).filter((name) => name.endsWith(".md")); } catch { return []; }
  return names.sort().flatMap((name) => {
    const file = path.join(dir, name);
    if (excluded?.has(realOrSelf(file))) return [];
    const found = readAgentFile(file, source, scope, packageName);
    return found ? [found] : [];
  });
}

function realOrSelf(target: string): string {
  try { return nodeFs.realpathSync(path.resolve(target)); } catch { return path.resolve(target); }
}

function inside(root: string, candidate: string): boolean {
  const rel = path.relative(realOrSelf(root), realOrSelf(candidate));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** `package-resources.ts`: a package's `pi.subagents` (or `pi-subagents`) declaration, resolved inside it. */
function packageAgents(root: string): { name?: string; dirs: string[]; files: string[]; excluded: Set<string> } | undefined {
  let manifest: Record<string, unknown>;
  try { manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as Record<string, unknown>; } catch { return undefined; }
  const list = (value: unknown) => (Array.isArray(value) && value.every((item) => typeof item === "string") ? value as string[] : undefined);
  const declaration = (value: unknown) => list(value) ?? (value && typeof value === "object" && !Array.isArray(value) ? list((value as Record<string, unknown>).agents) : undefined);
  const pi = manifest.pi && typeof manifest.pi === "object" ? (manifest.pi as Record<string, unknown>).subagents : undefined;
  const entries = declaration(pi) ?? declaration(manifest["pi-subagents"]);
  if (!entries) return undefined;
  const excluded = new Set(entries.filter((entry) => entry.startsWith("!")).map((entry) => path.resolve(root, entry.slice(1))).filter((target) => inside(root, target)).map(realOrSelf));
  const dirs: string[] = [];
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.startsWith("!")) continue;
    const target = path.resolve(root, entry);
    if (!inside(root, target) || !existsSync(target) || excluded.has(realOrSelf(target))) continue;
    const stat = statSync(target);
    if (stat.isDirectory()) { if (!dirs.includes(target)) dirs.push(target); } else if (stat.isFile() && target.endsWith(".md") && !files.includes(target)) files.push(target);
  }
  return { ...(typeof manifest.name === "string" ? { name: manifest.name } : {}), dirs, files, excluded };
}

async function configuredPackageRoots(ctx: SubagentContext): Promise<string[]> {
  if (ctx.packages) return ctx.packages();
  try {
    // shortcut: lists user and project packages regardless of pi's project trust and the packageAgents gate; mirror them if a project relies on either.
    const manager = await packageManagerFor(ctx.root, ctx.agentDir);
    return [...new Set(manager.listConfiguredPackages().flatMap((row) => (row.installedPath ? [row.installedPath] : [])))];
  } catch {
    return [];
  }
}

type BuiltinConfig = { name: string; displayName?: string; description: string; builtinToolNames?: string[]; allowedSubagents?: "all" | string[]; systemPrompt: string; promptMode: "replace" | "append"; model?: string; thinking?: string };
const builtinCache = new Map<string, Promise<BuiltinConfig[]>>();

/** pi-subagents' built-in defaults, read from the installed package (its `default-agents.js` has no imports). */
function builtins(packageRoots: string[]): Promise<BuiltinConfig[]> {
  const root = packageRoots.find((candidate) => {
    try { return (JSON.parse(readFileSync(path.join(candidate, "package.json"), "utf8")) as { name?: unknown }).name === SUBAGENTS_PACKAGE; } catch { return false; }
  });
  if (!root) return Promise.resolve([]);
  const file = path.join(root, "dist", "default-agents.js");
  let cached = builtinCache.get(file);
  if (!cached) {
    cached = import(pathToFileURL(file).href)
      .then((module: { DEFAULT_AGENTS?: Map<string, BuiltinConfig> }) => [...(module.DEFAULT_AGENTS?.values() ?? [])])
      .catch(() => []);
    builtinCache.set(file, cached);
  }
  return cached;
}

/** A file for a built-in default, in the shape pi-subagents' own eject writes. */
function builtinFile(config: BuiltinConfig, name: string): string {
  const lines = [`name: ${name}`, `description: ${JSON.stringify(config.description)}`];
  if (config.displayName) lines.push(`display_name: ${yamlScalar(config.displayName)}`);
  if (config.builtinToolNames) lines.push(`tools: ${config.builtinToolNames.length ? config.builtinToolNames.join(", ") : "none"}`);
  if (config.model) lines.push(`model: ${yamlScalar(config.model)}`);
  if (config.thinking) lines.push(`thinking: ${config.thinking}`);
  if (config.allowedSubagents) lines.push(`allowed_subagents: ${config.allowedSubagents === "all" ? "all" : config.allowedSubagents.join(", ")}`);
  lines.push(`prompt_mode: ${config.promptMode}`);
  return `---\n${lines.join("\n")}\n---\n${config.systemPrompt ? `\n${config.systemPrompt}\n` : ""}`;
}

/** Every agent pi-subagents would see for this project, lowest priority first, with override status. */
export async function discoverAgents(ctx: SubagentContext): Promise<{ found: Found[]; builtin: BuiltinConfig[] }> {
  const roots = await configuredPackageRoots(ctx);
  const builtin = await builtins(roots);
  const found: Found[] = builtin.map((config) => ({
    entry: {
      name: config.name, source: "builtin", active: false, enabled: true, description: config.description,
      skills: true, ...(config.builtinToolNames ? { tools: config.builtinToolNames.join(", ") } : {}),
      ...(config.model ? { model: config.model } : {}), ...(config.thinking ? { thinking: config.thinking } : {}),
      promptMode: config.promptMode, prompt: config.systemPrompt, otherFields: [],
    },
  }));
  const packages = roots.flatMap((root) => { const declared = packageAgents(root); return declared ? [declared] : []; });
  for (const pkg of packages) for (const dir of pkg.dirs) found.push(...readAgentDir(dir, "package", undefined, pkg.name, pkg.excluded));
  for (const pkg of packages) for (const file of pkg.files) { const one = readAgentFile(file, "package", undefined, pkg.name); if (one) found.push(one); }
  found.push(...readAgentDir(scopeDir(ctx, "global"), "global", "global"));
  found.push(...readAgentDir(path.join(ctx.root, ".agents", "agents"), "shared"));
  found.push(...readAgentDir(scopeDir(ctx, "project"), "project", "project"));
  // Later loads win by name; a file pi-subagents skips takes no part.
  const winner = new Map<string, number>();
  found.forEach(({ entry }, index) => { if (!entry.error) winner.set(entry.name, index); });
  found.forEach(({ entry }, index) => {
    if (entry.error) return;
    const top = winner.get(entry.name)!;
    entry.active = top === index;
    if (!entry.active) entry.overriddenBy = found[top].entry.source;
    else {
      const below = found.slice(0, index).reverse().find(({ entry: other }) => other.name === entry.name && !other.error);
      if (below) entry.overrides = below.entry.source;
    }
  });
  return { found, builtin };
}

// ---- Skills ----------------------------------------------------------------------------

function lstatIsSymlink(target: string): boolean {
  try { return nodeFs.lstatSync(target).isSymbolicLink(); } catch { return false; }
}

/** The five roots and lookup rules of pi-subagents' `skill-loader.ts`, listed rather than searched. */
export function scanSubagentSkills(ctx: Pick<SubagentContext, "root" | "agentDir" | "home">): Map<string, { path: string; projectOnly: boolean }> {
  const home = ctx.home ?? os.homedir();
  const roots = [
    path.join(ctx.root, ".pi", "skills"), path.join(ctx.root, ".agents", "skills"),
    path.join(ctx.agentDir, "skills"), path.join(home, ".agents", "skills"), path.join(home, ".pi", "skills"),
  ];
  const skills = new Map<string, { path: string; projectOnly: boolean }>();
  roots.forEach((root, index) => {
    if (lstatIsSymlink(root) || !existsSync(root)) return;
    const add = (name: string, file: string) => { if (!isUnsafeName(name) && !skills.has(name)) skills.set(name, { path: file, projectOnly: index < 2 }); };
    let top: nodeFs.Dirent[] = [];
    try { top = readdirSync(root, { withFileTypes: true }); } catch { return; }
    // Flat files win over directories within one root, as `findInRoot` reads them first.
    for (const entry of top) if (entry.isFile() && entry.name.endsWith(".md")) add(entry.name.slice(0, -3), path.join(root, entry.name));
    const queue = [root];
    while (queue.length) {
      const current = queue.shift()!;
      let entries: nodeFs.Dirent[];
      try { entries = readdirSync(current, { withFileTypes: true }); } catch { continue; }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const dir = path.join(current, entry.name);
        if (existsSync(path.join(dir, "SKILL.md"))) add(entry.name, path.join(dir, "SKILL.md"));
        else queue.push(dir);
      }
    }
  });
  return skills;
}

export function skillList(ctx: SubagentContext): SubagentSkillInfo[] {
  const reachable = scanSubagentSkills(ctx);
  const list: SubagentSkillInfo[] = [...reachable].map(([name, found]) => ({ name, available: true, path: found.path, ...(found.projectOnly ? { projectOnly: true } : {}) }));
  for (const skill of ctx.inventorySkills?.() ?? []) {
    if (reachable.has(skill.name) || list.some((entry) => entry.name === skill.name)) continue;
    list.push({ name: skill.name, available: false, ...(skill.path ? { path: skill.path } : {}), reason: "Not available to sub-agents (outside sub-agent skill roots or behind a symlink)" });
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

// ---- Confined writes -------------------------------------------------------------------

export class SubagentConflictError extends Error {}

function validName(name: unknown): string {
  if (typeof name !== "string" || isUnsafeName(name)) throw new Error("Invalid agent name: use letters, digits, '.', '_' or '-', starting with a letter or digit, at most 128 characters");
  return name;
}

function validScope(scope: unknown): SubagentScope {
  if (scope !== "global" && scope !== "project") throw new Error("Unknown agent scope");
  return scope;
}

/** The scope's directory, created when missing, refused when it (or `.pi`) is a symlink. */
async function confinedDir(ctx: SubagentContext, scope: SubagentScope): Promise<string> {
  const base = scope === "global" ? ctx.agentDir : ctx.root;
  const dir = scopeDir(ctx, scope);
  await fs.mkdir(dir, { recursive: true });
  const [realBase, realDir] = await Promise.all([fs.realpath(base), fs.realpath(dir)]);
  if (realDir !== path.join(realBase, path.relative(base, dir))) throw new Error(`Refused: ${dir} is reached through a symlink`);
  return dir;
}

async function targetPath(ctx: SubagentContext, scope: SubagentScope, name: string): Promise<string> {
  const file = path.join(await confinedDir(ctx, scope), `${validName(name)}.md`);
  const stat = await fs.lstat(file).catch(() => undefined);
  if (stat && !stat.isFile()) throw new Error(`Refused: ${path.basename(file)} is a symlink or not a regular file`);
  return file;
}

async function readChecked(file: string, hash: unknown): Promise<string> {
  const content = await fs.readFile(file, "utf8").catch(() => { throw new SubagentConflictError("The agent file no longer exists; reload the list"); });
  if (typeof hash !== "string" || contentHash(content) !== hash) throw new SubagentConflictError("The agent file changed on disk since it was loaded; reload it before saving again");
  return content;
}

/** Write through a temporary file in the same directory: rename replaces, link refuses an existing target. */
async function writeAtomic(file: string, content: string, exclusive: boolean): Promise<void> {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  await fs.writeFile(temp, content, { flag: "wx" });
  try {
    if (exclusive) await fs.link(temp, file).catch((error: NodeJS.ErrnoException) => { throw error.code === "EEXIST" ? new Error(`An agent named ${path.basename(file, ".md")} already exists in this scope`) : error; });
    else await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

const NEW_AGENT = (name: string) => `---\nname: ${name}\ndescription: ${name}\ntools: read, grep, find, ls\nprompt_mode: replace\n---\n\nDescribe what this agent does and how it should work.\n`;

// Operations run one at a time: read, compare and write never interleave across requests.
let queue: Promise<unknown> = Promise.resolve();

async function data(ctx: SubagentContext): Promise<SubagentManagementData> {
  const { found } = await discoverAgents(ctx);
  let loaded: boolean | undefined;
  if (ctx.runtime.kind === "embedded" && ctx.runtime.sessionId) loaded = await subagentRpc(ctx.runtime.sessionId, "ping", {}, 2_000).then(() => true, () => false);
  const runUnavailableReason = ctx.runtime.kind !== "embedded"
    ? `Run needs the embedded agent runtime; this project uses ${ctx.runtime.kind}`
    : !ctx.runtime.sessionId ? "This project's runtime has not started" : loaded ? undefined : "pi-subagents is not loaded in this project";
  return {
    agents: found.map(({ entry }) => entry),
    skills: skillList(ctx),
    dirs: { global: scopeDir(ctx, "global"), project: scopeDir(ctx, "project") },
    ...(loaded !== undefined ? { loaded } : {}),
    canRun: !runUnavailableReason,
    ...(runUnavailableReason ? { runUnavailableReason } : {}),
  };
}

async function mutate(ctx: SubagentContext, operation: Exclude<SubagentManagementOperation, { action: "list" | "spawn" }>): Promise<string> {
  const scope = validScope(operation.scope);
  switch (operation.action) {
    case "create": {
      const name = validName(operation.name);
      await writeAtomic(await targetPath(ctx, scope, name), NEW_AGENT(name), true);
      return `Created ${name}`;
    }
    case "duplicate": {
      const name = validName(operation.name);
      const { found, builtin } = await discoverAgents(ctx);
      const from = operation.from;
      const source = found.find(({ entry }) => entry.source === from?.source && entry.name === from?.name && !entry.error);
      if (!source) throw new Error("The agent to duplicate was not found");
      const content = source.content === undefined
        ? builtinFile(builtin.find((config) => config.name === from.name)!, name)
        : setFrontmatterKey(source.content, "name", name);
      await writeAtomic(await targetPath(ctx, scope, name), content, true);
      return `Copied ${from.name} to ${scope} as ${name}`;
    }
    case "save": {
      const file = await targetPath(ctx, scope, operation.name);
      const content = await readChecked(file, operation.hash);
      const next = applyChanges(content, operation.changes ?? {});
      if (next !== content) await writeAtomic(file, next, false);
      return next === content ? "No changes" : `Saved ${operation.name}`;
    }
    case "rename": {
      const to = validName(operation.to);
      const file = await targetPath(ctx, scope, operation.name);
      const content = await readChecked(file, operation.hash);
      await writeAtomic(await targetPath(ctx, scope, to), setFrontmatterKey(content, "name", to), true);
      await fs.unlink(file);
      return `Renamed ${operation.name} to ${to}`;
    }
    case "delete": {
      const file = await targetPath(ctx, scope, operation.name);
      await readChecked(file, operation.hash);
      await fs.unlink(file);
      return `Deleted ${operation.name}`;
    }
    default:
      throw new Error("Unknown agent operation");
  }
}

/** One browser operation; always answers with the current list so the panel never shows stale files. */
export function manageSubagents(ctx: SubagentContext, operation: SubagentManagementOperation | undefined): Promise<Omit<SubagentManagementReply, "requestId">> {
  const run = async (): Promise<Omit<SubagentManagementReply, "requestId">> => {
    const action = operation?.action;
    if (action === "list") return { data: await data(ctx) };
    if (action === "spawn") {
      const { type, prompt } = operation as Extract<SubagentManagementOperation, { action: "spawn" }>;
      if (typeof type !== "string" || !type.trim() || type.length > 128) throw new Error("Choose an agent to run");
      if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 100_000) throw new Error("Enter a prompt to run the agent with");
      if (ctx.runtime.kind !== "embedded" || !ctx.runtime.sessionId) throw new Error(`Run needs the embedded agent runtime; this project uses ${ctx.runtime.kind}`);
      const sessionId = ctx.runtime.sessionId;
      await subagentRpc(sessionId, "ping", {}, 2_000).catch(() => { throw new Error("pi-subagents is not loaded in this project"); });
      const reply = await subagentRpc(sessionId, "spawn", { type, prompt, options: { description: `${type} (Agents panel)` } }) as { id?: unknown } | undefined;
      if (typeof reply?.id !== "string") throw new Error("pi-subagents returned no agent id");
      return { spawnedId: reply.id, message: `Started ${type} as ${reply.id}` };
    }
    if (action !== "create" && action !== "duplicate" && action !== "save" && action !== "rename" && action !== "delete") throw new Error("Unknown agent operation");
    try {
      const message = await mutate(ctx, operation as Exclude<SubagentManagementOperation, { action: "list" | "spawn" }>);
      return { message, data: await data(ctx) };
    } catch (error) {
      const conflict = error instanceof SubagentConflictError;
      return { error: error instanceof Error ? error.message : String(error), ...(conflict ? { conflict } : {}), data: await data(ctx) };
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}
