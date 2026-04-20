import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "node:sqlite";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const databaseUrl = process.env.DATABASE_URL || "file:./dev.db";
const relativePath = databaseUrl.replace(/^file:/, "");
const databasePath = path.resolve(__dirname, relativePath);
const journalPath = `${databasePath}-journal`;
const force = process.argv.includes("--force");
const sql = fs.readFileSync(path.join(__dirname, "init.sql"), "utf8");

if (fs.existsSync(databasePath) && !force) {
  console.log(
    `Banco ja existe em ${databasePath}. Use "npm run db:init -- --force" para recriar.`,
  );
  process.exit(0);
}

if (force) {
  fs.rmSync(databasePath, { force: true });
  fs.rmSync(journalPath, { force: true });
}

const db = new Database.DatabaseSync(databasePath);
db.exec("PRAGMA foreign_keys = ON;");
db.exec(sql);
db.close();

console.log(`Banco SQLite inicializado em ${databasePath}`);
