import fs from "fs";
import os from "os";
import path from "path";
import { Router } from "express";
import { randomBytes } from "crypto";
import OpenAI, { toFile } from "openai";
import { GoogleGenAI, RawReferenceImage } from "@google/genai";
import type Database from "better-sqlite3";

export function createRouter(db: InstanceType<typeof Database>, WORKSPACE: string) {
  const IMAGES_DIR = path.join(WORKSPACE, "files", "images");
  const router = Router();

  const DOCS_DIR = path.join(WORKSPACE, "files", "documents");

  // Legacy endpoint — kept for backward compat
  router.get("/api/images", (_req, res) => {
    if (!fs.existsSync(IMAGES_DIR)) return res.json([]);
    const files = fs
      .readdirSync(IMAGES_DIR)
      .filter((f) => /\.(png|jpg|jpeg|webp|gif)$/i.test(f) && /^[\w.-]+$/.test(f))
      .map((filename) => {
        const stat = fs.statSync(path.join(IMAGES_DIR, filename));
        return {
          filename,
          url: `/app/api/image-gen/image/${filename}`,
          size: stat.size,
          createdAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(files);
  });

  // Serve uploaded images from files/images/
  router.get("/api/uploads/image/:filename", (req, res) => {
    const { filename } = req.params;
    if (filename.includes("/") || filename.includes("..") || !/^[\w.-]+$/.test(filename)) {
      return res.status(400).json({ error: "Invalid filename" });
    }
    const abs = path.join(IMAGES_DIR, filename);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: "Not found" });
    const stat = fs.statSync(abs);
    const ext = path.extname(filename).toLowerCase();
    const mime: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
    };
    res.setHeader("Content-Type", mime[ext] || "image/png");
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Cache-Control", "public, max-age=86400");
    fs.createReadStream(abs).pipe(res);
  });

  // Combined uploads listing — images + documents
  router.get("/api/uploads", (_req, res) => {
    const results: {
      filename: string;
      type: "image" | "document";
      url: string;
      size: number;
      createdAt: string;
    }[] = [];

    if (fs.existsSync(IMAGES_DIR)) {
      fs.readdirSync(IMAGES_DIR)
        .filter((f) => /\.(png|jpg|jpeg|webp|gif)$/i.test(f) && /^[\w.-]+$/.test(f))
        .forEach((filename) => {
          const stat = fs.statSync(path.join(IMAGES_DIR, filename));
          results.push({
            filename,
            type: "image",
            url: `/api/files/images/${filename}`,
            size: stat.size,
            createdAt: stat.mtime.toISOString(),
          });
        });
    }

    if (fs.existsSync(DOCS_DIR)) {
      fs.readdirSync(DOCS_DIR)
        .filter((f) => /\.pdf$/i.test(f) && /^[\w.-]+$/.test(f))
        .forEach((filename) => {
          const stat = fs.statSync(path.join(DOCS_DIR, filename));
          results.push({
            filename,
            type: "document",
            url: `/app/api/uploads/doc/${filename}`,
            size: stat.size,
            createdAt: stat.mtime.toISOString(),
          });
        });
    }

    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(results);
  });

  // Serve PDF documents from files/documents/
  router.get("/api/uploads/doc/:filename", (req, res) => {
    const { filename } = req.params;
    if (filename.includes("/") || filename.includes("..") || !/^[\w.-]+$/.test(filename)) {
      return res.status(400).json({ error: "Invalid filename" });
    }
    const abs = path.join(DOCS_DIR, filename);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: "Not found" });
    const stat = fs.statSync(abs);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Cache-Control", "public, max-age=86400");
    fs.createReadStream(abs).pipe(res);
  });

  router.get("/api/image-gen/history", (_req, res) => {
    const rows = db
      .prepare(`SELECT * FROM image_generations ORDER BY created_at DESC LIMIT 100`)
      .all();
    res.json(rows);
  });

  router.get("/api/image-gen/image/:filename", (req, res) => {
    const { filename } = req.params;
    if (filename.includes("/") || filename.includes("..") || !/^[\w.-]+$/.test(filename)) {
      return res.status(400).json({ error: "Invalid filename" });
    }
    const abs = path.join(IMAGES_DIR, filename);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: "Not found" });
    const stat = fs.statSync(abs);
    const ext = path.extname(filename).toLowerCase();
    const mime =
      ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".webp"
          ? "image/webp"
          : "image/png";
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Cache-Control", "public, max-age=86400");
    fs.createReadStream(abs).pipe(res);
  });

  router.post("/api/image-gen/generate", async (req, res) => {
    const { prompt, model, size, quality, style, imageBase64 } = req.body as {
      prompt: string;
      model: "dall-e-3" | "imagen-4";
      size: string;
      quality?: string;
      style?: string;
      imageBase64?: string; // base64-encoded reference image (without data: prefix)
    };
    if (!prompt?.trim()) return res.status(400).json({ error: "prompt required" });
    if (!["dall-e-3", "imagen-4"].includes(model))
      return res.status(400).json({ error: "invalid model" });

    try {
      let b64: string;
      const ts = new Date()
        .toISOString()
        .replace(/[-T:.Z]/g, "")
        .slice(0, 15);
      const rand = randomBytes(3).toString("hex");
      const filename = `${ts}_${rand}.png`;
      const filepath = path.join(IMAGES_DIR, filename);

      if (model === "imagen-4") {
        const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });
        if (imageBase64) {
          // Reference image → Imagen edit mode (Google)
          const rawB64 = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;
          const refImage = new RawReferenceImage();
          refImage.referenceId = 1;
          refImage.referenceImage = { imageBytes: rawB64 };
          const response = await genai.models.editImage({
            model: "imagen-3.0-capability-001",
            prompt: prompt.trim(),
            referenceImages: [refImage],
            config: { numberOfImages: 1, outputMimeType: "image/png" },
          });
          b64 = response.generatedImages![0].image!.imageBytes as string;
        } else {
          // Text-only → Imagen 4 generate (Google)
          const response = await genai.models.generateImages({
            model: "imagen-4.0-generate-001",
            prompt: prompt.trim(),
            config: { numberOfImages: 1, outputMimeType: "image/png" },
          });
          b64 = response.generatedImages![0].image!.imageBytes as string;
        }
      } else {
        // DALL·E path (OpenAI)
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        if (imageBase64) {
          // Reference image → DALL·E 2 edit mode
          const tmpPath = path.join(os.tmpdir(), `imgref_${rand}.png`);
          const rawB64 = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;
          fs.writeFileSync(tmpPath, Buffer.from(rawB64, "base64"));
          try {
            const imageFile = await toFile(fs.createReadStream(tmpPath), "image.png", {
              type: "image/png",
            });
            const response = await openai.images.edit({
              model: "dall-e-2",
              image: imageFile,
              prompt: prompt.trim(),
              size: "1024x1024",
              response_format: "b64_json",
              n: 1,
            });
            const editB64 = response.data?.[0]?.b64_json;
            if (!editB64) throw new Error("No image data returned from DALL-E edit");
            b64 = editB64;
          } finally {
            fs.unlinkSync(tmpPath);
          }
        } else {
          // Text-only → DALL·E 3 generate
          const validSizes = ["1024x1024", "1792x1024", "1024x1792"];
          const imgSize = validSizes.includes(size) ? size : "1024x1024";
          const response = await openai.images.generate({
            model: "dall-e-3",
            prompt: prompt.trim(),
            size: imgSize as "1024x1024" | "1792x1024" | "1024x1792",
            quality: quality === "hd" ? "hd" : "standard",
            style: style === "natural" ? "natural" : "vivid",
            response_format: "b64_json",
            n: 1,
          });
          const genB64 = response.data?.[0]?.b64_json;
          if (!genB64) throw new Error("No image data returned from DALL-E generate");
          b64 = genB64;
        }
      }

      fs.writeFileSync(filepath, Buffer.from(b64, "base64"));

      const r = db
        .prepare(
          `INSERT INTO image_generations (prompt, model, size, quality, style, filename) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(prompt.trim(), model, size || "1024x1024", quality || null, style || null, filename);

      res
        .status(201)
        .json(db.prepare(`SELECT * FROM image_generations WHERE id=?`).get(r.lastInsertRowid));
    } catch (e: unknown) {
      console.error("[image-gen] Error:", e);
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  router.delete("/api/image-gen/:id", (req, res) => {
    const row = db
      .prepare(`SELECT filename FROM image_generations WHERE id=?`)
      .get(req.params.id) as { filename: string } | undefined;
    if (row) {
      const abs = path.join(IMAGES_DIR, row.filename);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    }
    db.prepare(`DELETE FROM image_generations WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  });

  return router;
}
