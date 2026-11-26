import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireMember } from "@/lib/access";

// Serves the sales playbook (a static design export copied from
// staging-1.glaura.ai/design/sales) to signed-in team members only — it lives
// under src/content, not public/, so it is never reachable without a session.
// Update it by replacing the files in src/content/playbook.

const ROOT = path.join(process.cwd(), "src", "content", "playbook");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  await requireMember();
  const segments = (await params).path;
  const file = path.resolve(ROOT, ...segments);
  const type = CONTENT_TYPES[path.extname(file).toLowerCase()];
  if (!file.startsWith(ROOT + path.sep) || !type) return new Response("Introuvable", { status: 404 });
  try {
    const body = await readFile(file);
    return new Response(body, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return new Response("Introuvable", { status: 404 });
  }
}
