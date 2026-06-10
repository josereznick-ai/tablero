import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import db from "./db.js";

const SECRET = process.env.JWT_SECRET || "cambiar-este-secreto-en-produccion";
const EXPIRES = "7d";

export function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}
export function verifyPassword(pw, hash) {
  return bcrypt.compareSync(pw, hash);
}
export function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, SECRET, { expiresIn: EXPIRES });
}

// Middleware: exige token válido
export function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No autenticado" });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Token inválido o vencido" });
  }
}

// Middleware: exige que el usuario sea miembro del tablero (:boardId)
export function boardMember(req, res, next) {
  const boardId = Number(req.params.boardId);
  const row = db
    .prepare("SELECT role FROM board_members WHERE board_id = ? AND user_id = ?")
    .get(boardId, req.user.id);
  if (!row) return res.status(403).json({ error: "Sin acceso a este tablero" });
  req.boardRole = row.role;
  next();
}
