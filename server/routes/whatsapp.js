import { Router } from "express";
import { requireWhatsAppAuth } from "../whatsapp/base44Auth.js";
import { whatsappService } from "../whatsapp/service.js";

const router = Router();

router.use(requireWhatsAppAuth);

router.get("/status", (req, res) => {
  res.json({ status: whatsappService.getStatus() });
});

router.post("/connect", async (req, res) => {
  await whatsappService.start();
  res.json({ status: whatsappService.publicStatus() });
});

router.post("/reconnect", async (req, res) => {
  res.json({ status: await whatsappService.reconnect() });
});

router.post("/logout", async (req, res) => {
  res.json({ status: await whatsappService.logout() });
});

router.get("/chats", async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.slice(0, 100) : "";
  res.json({ chats: await whatsappService.getChats(search) });
});

router.get("/chats/:jid/messages", (req, res) => {
  const offset = Math.max(0, Math.min(10_000, Number.parseInt(req.query.offset, 10) || 0));
  const jid = whatsappService.canonicalChatJid(req.params.jid);
  res.json({ jid, messages: whatsappService.getMessages(jid, offset) });
});

router.post("/chats/:jid/messages", async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  const requestId = typeof req.body?.requestId === "string" ? req.body.requestId.trim() : "";
  if (!text) return res.status(400).json({ error: "Escreva uma mensagem antes de enviar." });
  if (text.length > 4096) return res.status(400).json({ error: "A mensagem deve ter até 4.096 caracteres." });
  if (!requestId || requestId.length > 100) return res.status(400).json({ error: "Identificador do envio inválido. Tente novamente." });
  try {
    const message = await whatsappService.sendText(req.params.jid, text, requestId);
    return res.status(201).json({ message });
  } catch (error) {
    return res.status(503).json({ error: error.message || "Não foi possível enviar a mensagem." });
  }
});

router.post("/chats/:jid/read", async (req, res) => {
  await whatsappService.markRead(req.params.jid);
  res.json({ ok: true });
});

router.use((error, req, res, next) => {
  console.error("Erro na integração WhatsApp:", error.message);
  res.status(500).json({ error: "Não foi possível concluir a operação do WhatsApp." });
});

export default router;
