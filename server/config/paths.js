import "./env.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const databasePath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(__dirname, "..", "database", "data", "app.sqlite");

const uploadsPath = process.env.UPLOADS_PATH
  ? path.resolve(process.env.UPLOADS_PATH)
  : path.join(__dirname, "..", "database", "data", "uploads");

const clientLogosDirectory = path.join(
  uploadsPath,
  "client-logos"
);

export { databasePath, uploadsPath, clientLogosDirectory };
