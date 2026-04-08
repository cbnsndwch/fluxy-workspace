import { Router } from "express";
import type Database from "better-sqlite3";

export function createRouter(db: InstanceType<typeof Database>) {
  const router = Router();

  router.get("/api/app-ideas", (_req, res) => {
    const ideas = db.prepare(`SELECT * FROM app_ideas ORDER BY group_name, name`).all();
    const connections = db.prepare(`SELECT * FROM app_idea_connections`).all();
    res.json({ ideas, connections });
  });

  router.post("/api/app-ideas", (req, res) => {
    const { name, description, stage, tags, group_name, color, pos_x, pos_y } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    const r = db
      .prepare(
        `INSERT INTO app_ideas (name,description,stage,tags,group_name,color,pos_x,pos_y) VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        name,
        description || null,
        stage || "idea",
        JSON.stringify(tags || []),
        group_name || null,
        color || null,
        pos_x ?? 0,
        pos_y ?? 0,
      );
    res.status(201).json(db.prepare(`SELECT * FROM app_ideas WHERE id=?`).get(r.lastInsertRowid));
  });

  router.put("/api/app-ideas/:id", (req, res) => {
    const { name, description, stage, tags, group_name, color, pos_x, pos_y } = req.body;
    db.prepare(
      `UPDATE app_ideas SET name=?,description=?,stage=?,tags=?,group_name=?,color=?,pos_x=?,pos_y=?,updated_at=datetime('now') WHERE id=?`,
    ).run(
      name,
      description || null,
      stage || "idea",
      JSON.stringify(tags || []),
      group_name || null,
      color || null,
      pos_x ?? 0,
      pos_y ?? 0,
      req.params.id,
    );
    res.json(db.prepare(`SELECT * FROM app_ideas WHERE id=?`).get(req.params.id));
  });

  router.patch("/api/app-ideas/:id/position", (req, res) => {
    const { pos_x, pos_y } = req.body;
    db.prepare(`UPDATE app_ideas SET pos_x=?,pos_y=? WHERE id=?`).run(pos_x, pos_y, req.params.id);
    res.json({ ok: true });
  });

  router.delete("/api/app-ideas/:id", (req, res) => {
    db.prepare(`DELETE FROM app_ideas WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  });

  router.post("/api/app-ideas/connections", (req, res) => {
    const { source_id, target_id, label, strength } = req.body;
    if (!source_id || !target_id)
      return res.status(400).json({ error: "source_id and target_id required" });
    const r = db
      .prepare(
        `INSERT INTO app_idea_connections (source_id,target_id,label,strength) VALUES (?,?,?,?)`,
      )
      .run(source_id, target_id, label || null, strength || 1);
    res
      .status(201)
      .json(db.prepare(`SELECT * FROM app_idea_connections WHERE id=?`).get(r.lastInsertRowid));
  });

  router.delete("/api/app-ideas/connections/:id", (req, res) => {
    db.prepare(`DELETE FROM app_idea_connections WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  });

  return router;
}
