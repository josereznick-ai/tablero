import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import db from "./db.js";
import {
  auth, boardMember, signToken,
  hashPassword, verifyPassword,
} from "./auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, "..", "public")));

/* ----------------------------- AUTENTICACIÓN ----------------------------- */

app.post("/api/register", (req, res) => {
  const { email, name, password } = req.body || {};
  if (!email || !name || !password)
    return res.status(400).json({ error: "Faltan datos" });
  if (password.length < 6)
    return res.status(400).json({ error: "La contraseña debe tener 6+ caracteres" });
  try {
    const info = db
      .prepare("INSERT INTO users (email, name, pass_hash) VALUES (?, ?, ?)")
      .run(email.toLowerCase().trim(), name.trim(), hashPassword(password));
    const user = { id: Number(info.lastInsertRowid), email, name };
    res.json({ token: signToken(user), user });
  } catch (e) {
    if (String(e).includes("UNIQUE"))
      return res.status(409).json({ error: "Ese email ya está registrado" });
    res.status(500).json({ error: "Error interno" });
  }
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare("SELECT * FROM users WHERE email = ?").get((email || "").toLowerCase().trim());
  if (!u || !verifyPassword(password || "", u.pass_hash))
    return res.status(401).json({ error: "Credenciales incorrectas" });
  const user = { id: u.id, email: u.email, name: u.name };
  res.json({ token: signToken(user), user });
});

/* -------------------------------- TABLEROS ------------------------------- */

app.get("/api/boards", auth, (req, res) => {
  const rows = db.prepare(`
    SELECT b.id, b.name, bm.role
    FROM boards b JOIN board_members bm ON bm.board_id = b.id
    WHERE bm.user_id = ? ORDER BY b.created_at DESC
  `).all(req.user.id);
  res.json(rows);
});

app.post("/api/boards", auth, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "Falta el nombre" });
  db.exec("BEGIN");
  let id;
  try {
    const info = db.prepare("INSERT INTO boards (name, owner_id) VALUES (?, ?)")
      .run(name.trim(), req.user.id);
    id = Number(info.lastInsertRowid);
    db.prepare("INSERT INTO board_members (board_id, user_id, role) VALUES (?, ?, 'owner')")
      .run(id, req.user.id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    return res.status(500).json({ error: "No se pudo crear el tablero" });
  }
  res.json({ id, name, role: "owner" });
});

// Invitar a un usuario existente (por email) al tablero
app.post("/api/boards/:boardId/members", auth, boardMember, (req, res) => {
  if (req.boardRole !== "owner")
    return res.status(403).json({ error: "Solo el propietario puede invitar" });
  const u = db.prepare("SELECT id FROM users WHERE email = ?").get((req.body.email || "").toLowerCase().trim());
  if (!u) return res.status(404).json({ error: "No existe un usuario con ese email" });
  db.prepare("INSERT OR IGNORE INTO board_members (board_id, user_id) VALUES (?, ?)")
    .run(Number(req.params.boardId), u.id);
  res.json({ ok: true });
});

app.get("/api/boards/:boardId/members", auth, boardMember, (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.name, u.email, bm.role
    FROM board_members bm JOIN users u ON u.id = bm.user_id
    WHERE bm.board_id = ?
  `).all(Number(req.params.boardId));
  res.json(rows);
});

/* --------------------------------- TAREAS -------------------------------- */

app.get("/api/boards/:boardId/tasks", auth, boardMember, (req, res) => {
  const rows = db.prepare(`
    SELECT t.*, u.name AS assignee_name
    FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
    WHERE t.board_id = ? ORDER BY t.position, t.id
  `).all(Number(req.params.boardId));
  res.json(rows);
});

app.post("/api/boards/:boardId/tasks", auth, boardMember, (req, res) => {
  const { title, status = "todo", assignee_id = null, priority = "normal", due_date = null } = req.body || {};
  if (!title) return res.status(400).json({ error: "Falta el título" });
  const info = db.prepare(`
    INSERT INTO tasks (board_id, title, status, assignee_id, priority, due_date, position, created_by)
    VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position),0)+1 FROM tasks WHERE board_id=?), ?)
  `).run(Number(req.params.boardId), title.trim(), status, assignee_id, priority, due_date, Number(req.params.boardId), req.user.id);
  res.json(db.prepare("SELECT * FROM tasks WHERE id = ?").get(Number(info.lastInsertRowid)));
});

// Actualización con bloqueo optimista: el cliente envía la version que tenía.
app.patch("/api/boards/:boardId/tasks/:id", auth, boardMember, (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare("SELECT * FROM tasks WHERE id = ? AND board_id = ?").get(id, Number(req.params.boardId));
  if (!cur) return res.status(404).json({ error: "Tarea inexistente" });
  if (req.body.version != null && req.body.version !== cur.version)
    return res.status(409).json({ error: "Conflicto: la tarea fue modificada por otro usuario", current: cur });

  const f = (k, d) => (req.body[k] !== undefined ? req.body[k] : d);
  db.prepare(`
    UPDATE tasks SET title=?, status=?, assignee_id=?, priority=?, due_date=?, position=?,
      version=version+1, updated_at=datetime('now')
    WHERE id=?
  `).run(
    f("title", cur.title), f("status", cur.status), f("assignee_id", cur.assignee_id),
    f("priority", cur.priority), f("due_date", cur.due_date), f("position", cur.position), id
  );
  res.json(db.prepare("SELECT * FROM tasks WHERE id = ?").get(id));
});

app.delete("/api/boards/:boardId/tasks/:id", auth, boardMember, (req, res) => {
  db.prepare("DELETE FROM tasks WHERE id = ? AND board_id = ?")
    .run(Number(req.params.id), Number(req.params.boardId));
  res.json({ ok: true });
});

/* --------------------------------- EVENTOS ------------------------------- */

app.get("/api/boards/:boardId/events", auth, boardMember, (req, res) => {
  const rows = db.prepare(`
    SELECT e.*, u.name AS author_name
    FROM events e JOIN users u ON u.id = e.created_by
    WHERE e.board_id = ? ORDER BY e.date
  `).all(Number(req.params.boardId));
  res.json(rows);
});

app.post("/api/boards/:boardId/events", auth, boardMember, (req, res) => {
  const { date, title } = req.body || {};
  if (!date || !title) return res.status(400).json({ error: "Faltan fecha o título" });
  const info = db.prepare("INSERT INTO events (board_id, date, title, created_by) VALUES (?, ?, ?, ?)")
    .run(Number(req.params.boardId), date, title.trim(), req.user.id);
  res.json(db.prepare("SELECT * FROM events WHERE id = ?").get(Number(info.lastInsertRowid)));
});

app.delete("/api/boards/:boardId/events/:id", auth, boardMember, (req, res) => {
  db.prepare("DELETE FROM events WHERE id = ? AND board_id = ?")
    .run(Number(req.params.id), Number(req.params.boardId));
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Tablero corriendo en http://localhost:${PORT}`));
