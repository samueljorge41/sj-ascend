import "./config/env.js";
import express from "express";
import cors from "cors";
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server as SocketServer } from "socket.io";
import "./database/db.js";

import metaAds from "./metaAds.js";
import clientsRoutes from "./routes/clients.js";
import settingsRoutes from "./routes/settings.js";
import clientOperationsRoutes from "./routes/clientOperations.js";
import clientDemandsRoutes from "./routes/clientDemands.js";
import prospectsRoutes from "./routes/prospects.js";
import automationsRoutes from "./routes/automations.js";
import agendaRoutes from "./routes/agenda.js";
import relationshipReportsRoutes from "./routes/relationshipReports.js";
import financeRoutes from "./routes/finance.js";
import whatsappRoutes from "./routes/whatsapp.js";
import { authenticateWhatsApp } from "./whatsapp/base44Auth.js";
import { whatsappService } from "./whatsapp/service.js";
import { uploadsPath } from "./config/paths.js";
import {
  setGoogleCalendarRealtime,
  startGoogleCalendarBackgroundSync,
  startGoogleCalendarWatchRenewal,
} from "./googleCalendarSync.js";

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
app.use("/api/prospects", prospectsRoutes);
app.use("/api/automations", automationsRoutes);
app.use("/api/agenda", agendaRoutes);
app.use("/api/relationship-reports", relationshipReportsRoutes);
app.use("/api/finance", financeRoutes);
app.use("/api/whatsapp", whatsappRoutes);

const server = http.createServer(app);
const io = new SocketServer(server);
setGoogleCalendarRealtime(io);
startGoogleCalendarWatchRenewal();
startGoogleCalendarBackgroundSync();
io.use(async (socket, next) => {
  const { token, appId } = socket.handshake.auth || {};
  const result = await authenticateWhatsApp(token, appId, {
    origin: socket.handshake.headers.origin,
    host: socket.handshake.headers.host,
    remoteAddress: socket.handshake.address,
  });
  if (!result.user) return next(new Error(result.error));
  socket.data.user = result.user;
  socket.data.auth = { token, appId };
  return next();
});
io.on("connection", (socket) => {
  const validationTimer = setInterval(async () => {
    const { token, appId } = socket.data.auth;
    const result = await authenticateWhatsApp(token, appId, {
      origin: socket.handshake.headers.origin,
      host: socket.handshake.headers.host,
      remoteAddress: socket.handshake.address,
    });
    if (!result.user) socket.disconnect(true);
  }, 60_000);
  validationTimer.unref?.();
  socket.on("disconnect", () => clearInterval(validationTimer));
});
whatsappService.setRealtime(io);
whatsappService.resumeStoredSession();

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

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `🚀 Servidor iniciado na porta ${PORT}`
  );
});
