import { promises as fs } from "fs";
import path from "path";

export const FACTORY_ROOT = process.cwd();

export const TEMPLATE_DIR = path.join(
  FACTORY_ROOT,
  process.env.FACTORY_TEMPLATE_DIR ?? "templates/micro-saas-template"
);

export const PRODUCTS_DIR = path.join(
  FACTORY_ROOT,
  process.env.FACTORY_PRODUCTS_DIR ?? "products"
);

export interface Idea {
  id: number;
  name: string;
  slug: string;
  problem: string;
  target: string;
  price: string;
}

export interface CreateMicroSaaSInput {
  name: string;
  problem: string;
  target: string;
  price: string;
  slug?: string;
}

export interface CreatedProduct {
  slug: string;
  name: string;
  dir: string;
  files: number;
  manifestPath: string;
}

export interface ProductSummary {
  slug: string;
  name: string;
  problem: string;
  target: string;
  price: string;
  createdAt: string;
  files: number;
}

export interface ReplacementMap {
  [token: string]: string;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) {
    throw new Error(`Cannot derive a valid slug from name "${input}"`);
  }
  return slug;
}

export function validateSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new Error(
      `Invalid slug "${slug}". Use lowercase letters, digits and single dashes.`
    );
  }
}

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".sql",
  ".css",
  ".html",
  ".txt",
  ".env",
  ".example",
  ".yml",
  ".yaml",
  ".xml",
  ".csv",
  ".svg",
]);

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build"]);

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        out.push(...(await listFiles(full)));
      }
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out.sort();
}

async function copyTemplate(src: string, dest: string): Promise<string[]> {
  const files = await listFiles(src);
  const written: string[] = [];
  for (const file of files) {
    const rel = path.relative(src, file);
    const target = path.join(dest, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(file, target);
    written.push(rel);
  }
  return written;
}

export function applyReplacements(content: string, map: ReplacementMap): string {
  let out = content;
  for (const [token, value] of Object.entries(map)) {
    out = out.split(token).join(value);
  }
  return out;
}

export function buildReplacements(input: {
  name: string;
  slug: string;
  problem: string;
  target: string;
  price: string;
}): ReplacementMap {
  const titleCase = input.name
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
  return {
    "__PRODUCT_NAME__": input.name,
    "__PRODUCT_NAME_TITLE__": titleCase,
    "__PRODUCT_SLUG__": input.slug,
    "__PRODUCT_PROBLEM__": input.problem,
    "__PRODUCT_TARGET__": input.target,
    "__PRODUCT_PRICE__": input.price,
  };
}

async function replaceInTree(
  dir: string,
  map: ReplacementMap
): Promise<number> {
  const files = await listFiles(dir);
  let replaced = 0;
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) continue;
    const original = await fs.readFile(file, "utf8");
    const next = applyReplacements(original, map);
    if (next !== original) {
      await fs.writeFile(file, next, "utf8");
      replaced += 1;
    }
  }
  return replaced;
}

export async function createMicroSaaS(
  input: CreateMicroSaaSInput
): Promise<CreatedProduct> {
  if (!input.name || !input.name.trim()) {
    throw new Error("Field 'name' is required");
  }
  if (!input.problem || !input.problem.trim()) {
    throw new Error("Field 'problem' is required");
  }
  if (!input.target || !input.target.trim()) {
    throw new Error("Field 'target' is required");
  }
  if (!input.price || !input.price.trim()) {
    throw new Error("Field 'price' is required");
  }

  const slug = input.slug ? slugify(input.slug) : slugify(input.name);
  validateSlug(slug);

  const templateStat = await fs.stat(TEMPLATE_DIR).catch(() => null);
  if (!templateStat || !templateStat.isDirectory()) {
    throw new Error(`Template not found at ${TEMPLATE_DIR}`);
  }

  const dest = path.join(PRODUCTS_DIR, slug);
  const destStat = await fs.stat(dest).catch(() => null);
  if (destStat) {
    throw new Error(`Product already exists: ${slug}`);
  }

  await fs.mkdir(PRODUCTS_DIR, { recursive: true });
  await fs.mkdir(dest, { recursive: true });

  const copied = await copyTemplate(TEMPLATE_DIR, dest);

  const replacements = buildReplacements({
    name: input.name.trim(),
    slug,
    problem: input.problem.trim(),
    target: input.target.trim(),
    price: input.price.trim(),
  });
  const replacedCount = await replaceInTree(dest, replacements);

  const manifest = {
    slug,
    name: input.name.trim(),
    problem: input.problem.trim(),
    target: input.target.trim(),
    price: input.price.trim(),
    createdAt: new Date().toISOString(),
    template: "micro-saas-template",
    files: copied.length,
    replacedFiles: replacedCount,
  };
  const manifestPath = path.join(dest, "factory.manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  return {
    slug,
    name: manifest.name,
    dir: dest,
    files: copied.length,
    manifestPath,
  };
}

export async function listProducts(): Promise<ProductSummary[]> {
  const stat = await fs.stat(PRODUCTS_DIR).catch(() => null);
  if (!stat || !stat.isDirectory()) return [];
  const entries = await fs.readdir(PRODUCTS_DIR, { withFileTypes: true });
  const out: ProductSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(PRODUCTS_DIR, entry.name, "factory.manifest.json");
    const raw = await fs.readFile(manifestPath, "utf8").catch(() => null);
    if (!raw) continue;
    try {
      const m = JSON.parse(raw) as ProductSummary & { files?: number };
      out.push({
        slug: m.slug ?? entry.name,
        name: m.name,
        problem: m.problem,
        target: m.target,
        price: m.price,
        createdAt: m.createdAt,
        files: m.files ?? 0,
      });
    } catch {
      // ignore malformed manifests
    }
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function listIdeas(): Promise<Idea[]> {
  const ideasPath = path.join(FACTORY_ROOT, "IDEAS.md");
  const raw = await fs.readFile(ideasPath, "utf8").catch(() => null);
  if (!raw) return [];
  const ideas: Idea[] = [];
  const lines = raw.split(/\r?\n/);
  let inTable = false;
  let id = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inTable) {
      if (/^\|\s*name\s*\|\s*problem\s*\|\s*target\s*\|\s*price\s*\|?$/i.test(trimmed)) {
        inTable = true;
      }
      continue;
    }
    if (!trimmed.startsWith("|")) break;
    if (/^\|[\s:|-]+\|?$/.test(trimmed)) continue; // separator row
    const cells = trimmed
      .split("|")
      .map((c) => c.trim())
      .filter((c, i, arr) => !(i === 0 && c === "") && !(i === arr.length - 1 && c === ""));
    if (cells.length < 4) continue;
    const [name, problem, target, price] = cells;
    if (!name || name.toLowerCase() === "name") continue;
    id += 1;
    ideas.push({ id, name, slug: slugify(name), problem, target, price });
  }
  return ideas;
}
