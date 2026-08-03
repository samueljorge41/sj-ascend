import "./config/env.js";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "./database/db.js";

import metaAds from "./metaAds.js";
import clientsRoutes from "./routes/clients.js";
import settingsRoutes from "./routes/settings.js";
import clientOperationsRoutes from "./routes/clientOperations.js";
import clientDemandsRoutes from "./routes/clientDemands.js";
import { uploadsPath } from "./config/paths.js";

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);

const app = express();

app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

fs.mkdirSync(uploadsPath, { recursive: true });
app.use("/uploads", express.static(uploadsPath));
app.use("/meta", metaAds);
app.use("/api/clients", clientsRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/client-operations", clientOperationsRoutes);
app.use("/api/client-demands", clientDemandsRoutes);

const distPath = path.resolve(__dirname, "../dist");
const distExists = fs.existsSync(distPath);

if (!distExists) {
  console.warn("A pasta dist não existe. Execute npm run build.");
}

app.use(express.static(distPath));
app.use((req, res, next) => {
  if (req.method !== "GET") {
    return next();
  }

  const isApiRoute = ["/api", "/meta", "/uploads"].some((prefix) =>
    req.path.startsWith(prefix)
  );

  if (isApiRoute) {
    return next();
  }

  if (!distExists) {
    return res.status(500).send("A pasta dist não existe. Execute npm run build.");
  }

  res.sendFile(path.join(distPath, "index.html"));
});

const PORT =
  process.env.PORT ||
  3001;

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `🚀 Servidor iniciado na porta ${PORT}`
  );
});