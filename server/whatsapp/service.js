import crypto from "crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "../database/db.js";
import { advanceProspectAfterWhatsAppReply } from "../acquisition/whatsappAutomation.js";

let realtime = null;
let baileysModulePromise = null;
const PENDING_STATUS_TTL_MS = 5 * 60_000;
const MAX_PENDING_MESSAGE_STATUSES = 2_000;

function emit(event, payload) {
  realtime?.emit(event, payload);
}

function resolveSessionKey() {
  const encoded = process.env.WHATSAPP_SESSION_KEY?.trim();
  if (encoded) {
    const key = Buffer.from(encoded, "base64");
    return key.length === 32 ? key : null;
  }
  if (process.env.NODE_ENV === "production") return null;

  const keyPath = fileURLToPath(new URL("../.whatsapp-session-key", import.meta.url));
  try {
    const existingKey = Buffer.from(fs.readFileSync(keyPath, "utf8").trim(), "base64");
    return existingKey.length === 32 ? existingKey : null;
  } catch (error) {
    if (error.code !== "ENOENT") return null;
  }

  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  try {
    const descriptor = fs.openSync(keyPath, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, `${key.toString("base64")}\n`, "utf8");
    } finally {
      fs.closeSync(descriptor);
    }
    return key;
  } catch (error) {
    if (error.code !== "EEXIST") return null;
    try {
      const existingKey = Buffer.from(fs.readFileSync(keyPath, "utf8").trim(), "base64");
      return existingKey.length === 32 ? existingKey : null;
    } catch {
      return null;
    }
  }
}

function encrypt(text, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decrypt(record, key) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(record.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(record.auth_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function dateFromMessage(message) {
  const timestamp = message?.messageTimestamp;
  const value = typeof timestamp === "object" ? timestamp?.low : timestamp;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : Math.floor(Date.now() / 1000);
}

function unwrapContent(message) {
  let current = message || {};
  const wrappers = [
    "ephemeralMessage",
    "viewOnceMessage",
    "viewOnceMessageV2",
    "documentWithCaptionMessage",
    "editedMessage",
  ];
  while (true) {
    const wrapper = wrappers.find((key) => current?.[key]?.message);
    if (!wrapper) return current;
    current = current[wrapper].message;
  }
}

function messageContent(message, getContentType) {
  const content = unwrapContent(message?.message);
  const type = getContentType(content) || "conversation";
  const text = content?.conversation
    || content?.extendedTextMessage?.text
    || content?.imageMessage?.caption
    || content?.videoMessage?.caption
    || content?.documentMessage?.caption
    || content?.buttonsResponseMessage?.selectedDisplayText
    || content?.listResponseMessage?.title
    || content?.templateButtonReplyMessage?.selectedDisplayText
    || content?.reactionMessage?.text;

  const labels = {
    imageMessage: "Imagem",
    videoMessage: "Vídeo",
    audioMessage: "Áudio",
    documentMessage: "Documento",
    stickerMessage: "Figurinha",
    locationMessage: "Localização",
    contactMessage: "Contato",
    contactsArrayMessage: "Contatos",
    pollCreationMessage: "Enquete",
  };
  return { text: text || (labels[type] ? `[${labels[type]}]` : ""), type };
}

function normalizeChatJid(jid) {
  return typeof jid === "string"
    && (jid.endsWith("@s.whatsapp.net") || jid.endsWith("@g.us") || jid.endsWith("@lid"))
    && !jid.includes("status@")
    ? jid
    : null;
}

function isFallbackChatName(name) {
  const value = String(name || "").trim();
  return !value || /^[+\d\s().-]+$/.test(value);
}

function preferredChatName(currentName, incomingName) {
  const current = String(currentName || "").trim();
  const incoming = String(incomingName || "").trim();
  if (!isFallbackChatName(incoming)) return incoming;
  if (!isFallbackChatName(current)) return current;
  return current || incoming;
}

class WhatsAppService {
  constructor() {
    this.socket = null;
    this.status = { state: "disconnected", qr: null, phone: null, name: null, error: null };
    this.starting = null;
    this.retryTimer = null;
    this.retryCount = 0;
    this.qrGeneration = 0;
    this.sessionKey = resolveSessionKey();
    this.pendingMessageStatuses = new Map();
    this.duplicateChatMergeInFlight = null;
  }

  setRealtime(io) {
    realtime = io;
  }

  resumeStoredSession() {
    const hasSavedSession = db.prepare("SELECT 1 FROM whatsapp_auth WHERE id = 1").get();
    if (this.sessionKey && hasSavedSession) void this.start();
  }

  publishStatus(patch) {
    this.status = { ...this.status, ...patch };
    emit("whatsapp:status", this.publicStatus());
  }

  publicStatus() {
    return {
      state: this.status.state,
      qr: this.status.state === "qr" ? this.status.qr : null,
      phone: this.status.phone,
      name: this.status.name,
      error: this.status.error,
    };
  }

  getStatus() {
    if (!this.sessionKey) {
      return {
        ...this.publicStatus(),
        state: "error",
        error: process.env.WHATSAPP_SESSION_KEY
          ? "WHATSAPP_SESSION_KEY precisa conter exatamente 32 bytes em Base64."
          : "Configure WHATSAPP_SESSION_KEY no ambiente do backend para habilitar a sessão segura.",
        errorCode: "session_key_missing",
      };
    }
    void this.start();
    return this.publicStatus();
  }

  async loadBaileys() {
    if (!baileysModulePromise) baileysModulePromise = import("@whiskeysockets/baileys");
    return baileysModulePromise;
  }

  loadAuthState({ BufferJSON, initAuthCreds }) {
    const authRecord = db.prepare("SELECT * FROM whatsapp_auth WHERE id = 1").get();
    let creds;
    try {
      creds = authRecord
        ? JSON.parse(decrypt(authRecord, this.sessionKey), BufferJSON.reviver)
        : initAuthCreds();
    } catch {
      throw new Error("A chave de sessão não corresponde às credenciais criptografadas existentes.");
    }

    const saveCreds = (updatedCreds = {}) => {
      Object.assign(creds, updatedCreds);
      const encrypted = encrypt(JSON.stringify(creds, BufferJSON.replacer), this.sessionKey);
      db.prepare(`
        INSERT INTO whatsapp_auth (id, iv, auth_tag, ciphertext, updated_at)
        VALUES (1, @iv, @auth_tag, @ciphertext, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          iv = excluded.iv,
          auth_tag = excluded.auth_tag,
          ciphertext = excluded.ciphertext,
          updated_at = CURRENT_TIMESTAMP
      `).run(encrypted);
    };

    const getKey = db.prepare(`
      SELECT * FROM whatsapp_signal_keys WHERE key_type = ? AND key_id = ?
    `);
    const saveKey = db.prepare(`
      INSERT INTO whatsapp_signal_keys (key_type, key_id, iv, auth_tag, ciphertext, updated_at)
      VALUES (@type, @id, @iv, @auth_tag, @ciphertext, CURRENT_TIMESTAMP)
      ON CONFLICT(key_type, key_id) DO UPDATE SET
        iv = excluded.iv,
        auth_tag = excluded.auth_tag,
        ciphertext = excluded.ciphertext,
        updated_at = CURRENT_TIMESTAMP
    `);
    const deleteKey = db.prepare(
      "DELETE FROM whatsapp_signal_keys WHERE key_type = ? AND key_id = ?",
    );
    const saveKeysTransaction = db.transaction((updates) => {
      for (const [type, values] of Object.entries(updates || {})) {
        for (const [id, value] of Object.entries(values || {})) {
          if (value == null) {
            deleteKey.run(type, id);
          } else {
            saveKey.run({ type, id, ...encrypt(JSON.stringify(value, BufferJSON.replacer), this.sessionKey) });
          }
        }
      }
    });

    return {
      state: {
        creds,
        keys: {
          get: async (type, ids) => {
            const result = {};
            for (const id of ids) {
              const record = getKey.get(type, id);
              if (record) result[id] = JSON.parse(decrypt(record, this.sessionKey), BufferJSON.reviver);
            }
            return result;
          },
          set: async (updates) => saveKeysTransaction(updates),
        },
      },
      saveCreds,
    };
  }

  async start() {
    if (!this.sessionKey || this.socket || this.starting) return this.starting;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    this.starting = (async () => {
      this.publishStatus({ state: "connecting", qr: null, error: null });
      try {
        const baileys = await this.loadBaileys();
        const auth = this.loadAuthState(baileys);
        const logger = (await import("pino")).default({ level: "silent" });
        const socket = baileys.default({
          auth: auth.state,
          logger,
          printQRInTerminal: false,
          markOnlineOnConnect: false,
        });
        this.socket = socket;
        socket.ev.on("creds.update", auth.saveCreds);
        this.registerConnectionHandlers(socket, baileys);
        this.registerMessageHandlers(socket, baileys);
        this.registerChatHandlers(socket);
      } catch (error) {
        this.socket = null;
        this.publishStatus({ state: "error", qr: null, error: error.message || "Falha ao iniciar o WhatsApp." });
      } finally {
        this.starting = null;
      }
    })();
    return this.starting;
  }

  registerConnectionHandlers(socket, baileys) {
    socket.ev.on("connection.update", async ({ connection, qr, lastDisconnect }) => {
      if (this.socket !== socket) return;
      if (qr) {
        const generation = ++this.qrGeneration;
        try {
          const qrCode = (await import("qrcode")).default;
          const qrDataUrl = await qrCode.toDataURL(qr, { margin: 1, width: 280 });
          if (this.socket === socket && generation === this.qrGeneration && !socket.user?.id) {
            this.publishStatus({ state: "qr", qr: qrDataUrl, error: null });
          }
        } catch {
          if (this.socket === socket && generation === this.qrGeneration && !socket.user?.id) {
            this.publishStatus({ state: "error", qr: null, error: "Não foi possível gerar o QR Code." });
          }
        }
      }
      if (connection === "connecting" && !qr) {
        this.publishStatus({ state: "connecting", qr: null, error: null });
      }
      if (connection === "open") {
        this.qrGeneration += 1;
        this.retryCount = 0;
        this.publishStatus({
          state: "connected",
          qr: null,
          phone: socket.user?.id?.split(":")[0]?.split("@")[0] || null,
          name: socket.user?.name || null,
          error: null,
        });
        emit("whatsapp:chats", { refresh: true });
        void this.mergeExistingPhoneLidChats();
      }
      if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === baileys.DisconnectReason.loggedOut;
        this.socket = null;
        if (loggedOut) this.clearAuthState();
        this.publishStatus({
          state: loggedOut ? "disconnected" : "connecting",
          qr: null,
          phone: loggedOut ? null : this.status.phone,
          name: loggedOut ? null : this.status.name,
          error: null,
        });
        this.scheduleReconnect(loggedOut ? 500 : undefined);
      }
    });
  }

  async mergeExistingPhoneLidChats() {
    if (this.duplicateChatMergeInFlight) return this.duplicateChatMergeInFlight;
    const socket = this.socket;
    if (!socket?.onWhatsApp || this.status.state !== "connected") return;

    this.duplicateChatMergeInFlight = (async () => {
      let changed = false;
      const candidates = db.prepare(`
        SELECT chat.jid, chat.name
        FROM whatsapp_chats chat
        WHERE chat.jid LIKE '%@s.whatsapp.net'
          AND (COALESCE(chat.last_message, '') <> '' OR EXISTS (
            SELECT 1 FROM whatsapp_messages message WHERE message.chat_jid = chat.jid
          ))
          AND NOT EXISTS (
            SELECT 1 FROM whatsapp_jid_aliases alias
            WHERE alias.canonical_jid = chat.jid AND alias.alias_jid LIKE '%@lid'
          )
      `).all()
        .filter((chat) => isFallbackChatName(chat.name))
        .map((chat) => chat.jid);

      for (let offset = 0; offset < candidates.length; offset += 20) {
        if (this.socket !== socket || this.status.state !== "connected") return;
        const batch = candidates.slice(offset, offset + 20);
        try {
          const matches = await socket.onWhatsApp(...batch);
          if (this.socket !== socket || this.status.state !== "connected") return;
          for (const match of matches || []) {
            const phoneJid = normalizeChatJid(match?.jid);
            const lidJid = normalizeChatJid(match?.lid);
            if (!phoneJid?.endsWith("@s.whatsapp.net") || !lidJid?.endsWith("@lid")) continue;
            if (!batch.includes(phoneJid)) continue;
            this.linkPhoneAndLid(phoneJid, lidJid);
            changed = true;
          }
        } catch {
          // A temporary lookup failure should not interrupt WhatsApp reconnection.
        }
      }

      if (changed) emit("whatsapp:chats", { refresh: true });
    })().finally(() => {
      this.duplicateChatMergeInFlight = null;
    });

    return this.duplicateChatMergeInFlight;
  }

  resolveChatAlias(jid) {
    let current = normalizeChatJid(jid);
    const visited = new Set();
    while (current && !visited.has(current)) {
      visited.add(current);
      const alias = db.prepare("SELECT canonical_jid FROM whatsapp_jid_aliases WHERE alias_jid = ?").get(current);
      const next = normalizeChatJid(alias?.canonical_jid);
      if (!next || next === current) break;
      current = next;
    }
    return current;
  }

  linkPhoneAndLid(firstJid, secondJid) {
    const first = normalizeChatJid(firstJid);
    const second = normalizeChatJid(secondJid);
    if (!first || !second || first === second) return this.resolveChatAlias(first || second);

    const phoneJid = [first, second].find((jid) => jid.endsWith("@s.whatsapp.net"));
    const lidJid = [first, second].find((jid) => jid.endsWith("@lid"));
    if (!phoneJid || !lidJid) return this.resolveChatAlias(first);

    const merge = db.transaction(() => {
      const phoneChat = db.prepare("SELECT * FROM whatsapp_chats WHERE jid = ?").get(phoneJid);
      const lidChat = db.prepare("SELECT * FROM whatsapp_chats WHERE jid = ?").get(lidJid);
      const newestChat = Number(lidChat?.last_message_at || 0) > Number(phoneChat?.last_message_at || 0)
        ? lidChat
        : phoneChat;
      const name = preferredChatName(phoneChat?.name, lidChat?.name);

      db.prepare(`
        INSERT INTO whatsapp_chats (
          jid, name, avatar_url, avatar_checked_at, last_message, last_message_at,
          unread_count, is_group, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
        ON CONFLICT(jid) DO UPDATE SET
          name = excluded.name,
          avatar_url = CASE WHEN excluded.avatar_url <> '' THEN excluded.avatar_url ELSE whatsapp_chats.avatar_url END,
          avatar_checked_at = COALESCE(excluded.avatar_checked_at, whatsapp_chats.avatar_checked_at),
          last_message = CASE
            WHEN COALESCE(excluded.last_message_at, 0) >= COALESCE(whatsapp_chats.last_message_at, 0)
              THEN excluded.last_message ELSE whatsapp_chats.last_message END,
          last_message_at = MAX(COALESCE(whatsapp_chats.last_message_at, 0), COALESCE(excluded.last_message_at, 0)),
          unread_count = MAX(whatsapp_chats.unread_count, excluded.unread_count),
          is_group = 0,
          updated_at = CURRENT_TIMESTAMP
      `).run(
        phoneJid,
        name,
        phoneChat?.avatar_url || lidChat?.avatar_url || "",
        phoneChat?.avatar_checked_at || lidChat?.avatar_checked_at || null,
        newestChat?.last_message || "",
        newestChat?.last_message_at || null,
        Math.max(Number(phoneChat?.unread_count) || 0, Number(lidChat?.unread_count) || 0),
      );

      db.prepare("UPDATE whatsapp_messages SET chat_jid = ? WHERE chat_jid = ?").run(phoneJid, lidJid);
      db.prepare("DELETE FROM whatsapp_chats WHERE jid = ?").run(lidJid);
      db.prepare(`
        INSERT INTO whatsapp_jid_aliases (alias_jid, canonical_jid, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(alias_jid) DO UPDATE SET canonical_jid = excluded.canonical_jid, updated_at = CURRENT_TIMESTAMP
      `).run(lidJid, phoneJid);
    });

    merge();
    return phoneJid;
  }

  canonicalChatJid(jid, alternateJid = "") {
    const normalized = normalizeChatJid(jid);
    const alternate = normalizeChatJid(alternateJid);
    if (!normalized) return null;

    if (alternate) {
      const linked = this.linkPhoneAndLid(normalized, alternate);
      if (linked) return linked;
    }
    return this.resolveChatAlias(normalized);
  }

  async resolveOutgoingChatJid(jid) {
    const normalized = normalizeChatJid(jid);
    if (!normalized) throw new Error("Conversa do WhatsApp invalida.");
    const canonical = this.resolveChatAlias(normalized);
    if (normalized.endsWith("@lid")) {
      return { chatJid: canonical || normalized, recipientJid: normalized };
    }
    if (!canonical || !canonical.endsWith("@s.whatsapp.net")) {
      return { chatJid: canonical || normalized, recipientJid: canonical || normalized };
    }

    const knownLid = db.prepare(`
      SELECT alias_jid FROM whatsapp_jid_aliases
      WHERE canonical_jid = ? AND alias_jid LIKE '%@lid'
      LIMIT 1
    `).get(canonical);
    if (knownLid) return { chatJid: canonical, recipientJid: knownLid.alias_jid };
    if (!this.socket?.onWhatsApp) return { chatJid: canonical, recipientJid: canonical };

    try {
      const matches = await this.socket.onWhatsApp(canonical);
      const match = matches?.find((item) => normalizeChatJid(item.jid)?.endsWith("@s.whatsapp.net")) || matches?.[0];
      const phoneJid = normalizeChatJid(match?.jid) || canonical;
      const lidJid = normalizeChatJid(match?.lid);
      if (lidJid) {
        this.linkPhoneAndLid(phoneJid, lidJid);
        emit("whatsapp:chats", { refresh: true });
        return { chatJid: this.resolveChatAlias(phoneJid) || phoneJid, recipientJid: lidJid };
      }
    } catch {
      throw new Error("Nao foi possivel consultar o identificador do contato no WhatsApp. Tente novamente.");
    }
    return { chatJid: this.resolveChatAlias(canonical) || canonical, recipientJid: canonical };
  }

  registerMessageHandlers(socket, baileys) {
    const processMessage = (message, countUnread = false, broadcast = true) => {
      const jid = this.canonicalChatJid(message?.key?.remoteJid, message?.key?.remoteJidAlt);
      const id = message?.key?.id;
      if (!jid || !id) return null;

      const { text, type } = messageContent(message, baileys.getContentType);
      const timestamp = dateFromMessage(message);
      const fromMe = message.key.fromMe ? 1 : 0;
      const participant = message.key.participant || "";
      if (!text) return null;
      const pendingStatus = this.getPendingMessageStatus(id);
      const receivedStatus = Number(message.status);
      const status = pendingStatus === -1
        ? -1
        : Math.max(
          Number.isFinite(receivedStatus) ? receivedStatus : 0,
          fromMe ? 1 : 0,
          pendingStatus,
        );

      const upsertChat = db.prepare(`
        INSERT INTO whatsapp_chats (jid, name, last_message, last_message_at, unread_count, is_group, updated_at)
        VALUES (@jid, @name, @last_message, @last_message_at, @unread_count, @is_group, CURRENT_TIMESTAMP)
        ON CONFLICT(jid) DO UPDATE SET
          name = CASE WHEN excluded.name <> '' AND whatsapp_chats.name = '' THEN excluded.name ELSE whatsapp_chats.name END,
          last_message = CASE WHEN COALESCE(excluded.last_message_at, 0) >= COALESCE(whatsapp_chats.last_message_at, 0) THEN excluded.last_message ELSE whatsapp_chats.last_message END,
          last_message_at = MAX(COALESCE(whatsapp_chats.last_message_at, 0), COALESCE(excluded.last_message_at, 0)),
          unread_count = whatsapp_chats.unread_count + excluded.unread_count,
          is_group = excluded.is_group,
          updated_at = CURRENT_TIMESTAMP
      `);
      const insertMessage = db.prepare(`
        INSERT OR IGNORE INTO whatsapp_messages (id, chat_jid, from_me, text, message_type, timestamp, status, participant)
        VALUES (@id, @jid, @from_me, @text, @type, @timestamp, @status, @participant)
      `);

      const insert = db.transaction(() => {
        const exists = db.prepare("SELECT 1 FROM whatsapp_messages WHERE id = ?").get(id);
        if (exists) return false;
        const currentChat = db.prepare("SELECT name FROM whatsapp_chats WHERE jid = ?").get(jid);
        upsertChat.run({
          jid,
          name: preferredChatName(currentChat?.name, message.pushName || ""),
          last_message: text,
          last_message_at: timestamp,
          unread_count: countUnread && !fromMe ? 1 : 0,
          is_group: jid.endsWith("@g.us") ? 1 : 0,
        });
        insertMessage.run({
          id,
          jid,
          from_me: fromMe,
          text,
          type,
          timestamp,
          status,
          participant,
        });
        return true;
      });

      if (!insert()) {
        const savedStatus = Number(message.status);
        const latestStatus = Math.max(
          Number.isFinite(savedStatus) ? savedStatus : 0,
          pendingStatus,
        );
        this.pendingMessageStatuses.delete(id);
        if (latestStatus > 0) this.updateMessageStatus(id, latestStatus);
        return null;
      }
      this.pendingMessageStatuses.delete(id);
      const saved = db.prepare("SELECT * FROM whatsapp_messages WHERE id = ?").get(id);
      const chat = db.prepare("SELECT * FROM whatsapp_chats WHERE jid = ?").get(jid);
      if (!fromMe && broadcast) {
        try {
          const prospectUpdate = advanceProspectAfterWhatsAppReply({
            chatJid: jid,
            messageId: id,
            text,
            timestamp,
          });
          if (prospectUpdate) emit("whatsapp:prospect-updated", prospectUpdate);
        } catch (error) {
          console.error("Não foi possível atualizar a etapa da aquisição pela resposta do WhatsApp:", error.message);
        }
      }
      if (broadcast) {
        emit("whatsapp:message", { chat: this.formatChat(chat), message: this.formatMessage(saved) });
        emit("whatsapp:chats", { chat: this.formatChat(chat) });
      }
      return { jid, id, fromMe, participant };
    };

    socket.ev.on("messages.upsert", ({ messages, type }) => {
      for (const message of messages || []) {
        processMessage(message, type === "notify", type === "notify");
      }
    });

    socket.ev.on("messages.update", (updates) => {
      for (const { key, update } of updates || []) {
        if (!key?.id || update?.status == null) continue;
        const status = Number(update.status);
        this.updateMessageStatus(key.id, status === 0 ? -1 : status);
      }
    });

    socket.ev.on("message-receipt.update", (updates) => {
      for (const { key, receipt } of updates || []) {
        if (!key?.id) continue;
        const status = receipt?.readTimestamp ? 4 : receipt?.receiptTimestamp ? 3 : 2;
        this.updateMessageStatus(key.id, status);
      }
    });

    socket.ev.on("messaging-history.set", ({ chats, contacts, messages }) => {
      this.saveContacts(contacts || []);
      this.saveChats(chats || []);
      for (const message of messages || []) processMessage(message, false, false);
      emit("whatsapp:chats", { refresh: true });
    });
  }

  registerChatHandlers(socket) {
    socket.ev.on("contacts.upsert", (contacts) => this.saveContacts(contacts || []));
    socket.ev.on("contacts.update", (contacts) => this.saveContacts(contacts || []));
    socket.ev.on("chats.upsert", (chats) => this.saveChats(chats || []));
    socket.ev.on("chats.update", (chats) => this.saveChats(chats || [], true));
    socket.ev.on("chats.phoneNumberShare", ({ lid, jid } = {}) => {
      if (this.linkPhoneAndLid(jid, lid)) emit("whatsapp:chats", { refresh: true });
    });
  }

  saveContacts(contacts) {
    const save = db.prepare(`
      INSERT INTO whatsapp_chats (jid, name, is_group, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(jid) DO UPDATE SET
        name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE whatsapp_chats.name END,
        updated_at = CURRENT_TIMESTAMP
    `);
    const transaction = db.transaction((items) => {
      for (const contact of items) {
        const primaryJid = normalizeChatJid(contact.id || contact.jid);
        const alternateJid = normalizeChatJid(contact.lid || contact.lidJid);
        const jid = this.canonicalChatJid(primaryJid, alternateJid);
        if (!jid) continue;
        const name = contact.name || contact.notify || contact.verifiedName || contact.subject || "";
        const current = db.prepare("SELECT name FROM whatsapp_chats WHERE jid = ?").get(jid);
        save.run(jid, preferredChatName(current?.name, name), jid.endsWith("@g.us") ? 1 : 0);
      }
    });
    transaction(contacts);
    emit("whatsapp:chats", { refresh: true });
  }

  saveChats(chats, isUpdate = false) {
    const upsert = db.prepare(`
      INSERT INTO whatsapp_chats (jid, name, last_message_at, unread_count, is_group, updated_at)
      VALUES (@jid, @name, @last_message_at, @unread_count, @is_group, CURRENT_TIMESTAMP)
      ON CONFLICT(jid) DO UPDATE SET
        name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE whatsapp_chats.name END,
        last_message_at = COALESCE(excluded.last_message_at, whatsapp_chats.last_message_at),
        unread_count = CASE WHEN @is_update = 1 THEN excluded.unread_count ELSE MAX(whatsapp_chats.unread_count, excluded.unread_count) END,
        is_group = excluded.is_group,
        updated_at = CURRENT_TIMESTAMP
    `);
    const transaction = db.transaction((items) => {
      for (const chat of items) {
        const primaryJid = normalizeChatJid(chat.id || chat.jid);
        const alternateJid = normalizeChatJid(chat.lidJid || chat.lid);
        const jid = this.canonicalChatJid(primaryJid, alternateJid);
        if (!jid) continue;
        const conversationTimestamp = chat.conversationTimestamp;
        const timestamp = conversationTimestamp == null
          ? null
          : Number(typeof conversationTimestamp === "object" ? conversationTimestamp.low : conversationTimestamp);
        const current = db.prepare("SELECT name FROM whatsapp_chats WHERE jid = ?").get(jid);
        upsert.run({
          jid,
          name: preferredChatName(current?.name, chat.name || chat.subject || ""),
          last_message_at: Number.isFinite(timestamp) ? timestamp : null,
          unread_count: Math.max(0, Number(chat.unreadCount) || 0),
          is_group: jid.endsWith("@g.us") ? 1 : 0,
          is_update: isUpdate ? 1 : 0,
        });
      }
    });
    transaction(chats);
    emit("whatsapp:chats", { refresh: true });
  }

  scheduleReconnect(delay) {
    if (this.retryTimer || !this.sessionKey) return;
    this.retryCount += 1;
    const wait = delay ?? Math.min(30_000, 1_000 * (2 ** Math.min(this.retryCount - 1, 5)));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.start();
    }, wait);
    this.retryTimer.unref?.();
  }

  clearAuthState() {
    db.prepare("DELETE FROM whatsapp_auth WHERE id = 1").run();
    db.prepare("DELETE FROM whatsapp_signal_keys").run();
  }

  async reconnect() {
    if (!this.sessionKey) return this.getStatus();
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.end(undefined);
    }
    this.publishStatus({ state: "connecting", qr: null, error: null });
    await this.start();
    return this.publicStatus();
  }

  async logout() {
    this.clearAuthState();
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      try {
        await socket.logout();
      } catch {
        socket.end(undefined);
      }
    }
    this.publishStatus({ state: "disconnected", qr: null, phone: null, name: null, error: null });
    this.scheduleReconnect(500);
    return this.publicStatus();
  }

  async getChats(search = "") {
    const term = `%${search.trim()}%`;
    const chats = db.prepare(`
      SELECT * FROM whatsapp_chats
      WHERE (
        COALESCE(last_message, '') <> ''
        OR unread_count > 0
        OR (
          @search <> ''
          AND COALESCE(last_message, '') = ''
          AND COALESCE(last_message_at, 0) = 0
          AND unread_count = 0
        )
      )
        AND (@search = '' OR name LIKE @term OR jid LIKE @term OR last_message LIKE @term)
      ORDER BY COALESCE(last_message_at, 0) DESC, name COLLATE NOCASE ASC
      LIMIT 300
    `).all({ search: search.trim(), term }).map((chat) => this.formatChat(chat));

    if (this.status.state === "connected") void this.refreshAvatars(chats);
    return chats;
  }

  async refreshAvatars(chats) {
    const stale = chats.filter((chat) => !chat.avatarCheckedAt || Date.now() / 1000 - chat.avatarCheckedAt > 86_400).slice(0, 12);
    for (const chat of stale) {
      if (this.status.state !== "connected" || !this.socket) break;
      let avatarUrl = "";
      try {
        avatarUrl = await this.socket.profilePictureUrl(chat.jid, "image").catch(() => "");
      } catch { /* Contacts can hide their profile photo. */ }
      db.prepare("UPDATE whatsapp_chats SET avatar_url = ?, avatar_checked_at = ? WHERE jid = ?")
        .run(avatarUrl, Math.floor(Date.now() / 1000), chat.jid);
    }
    if (stale.length) emit("whatsapp:chats", { refresh: true });
  }

  formatChat(chat) {
    return {
      jid: chat.jid,
      name: chat.name || chat.jid.split("@")[0],
      avatarUrl: chat.avatar_url || "",
      avatarCheckedAt: chat.avatar_checked_at ? Number(chat.avatar_checked_at) : null,
      lastMessage: chat.last_message || "",
      lastMessageAt: chat.last_message_at ? Number(chat.last_message_at) : null,
      unreadCount: Number(chat.unread_count) || 0,
      isGroup: Boolean(chat.is_group),
      isContact: !chat.last_message && !chat.last_message_at && !Number(chat.unread_count),
    };
  }

  formatMessage(message) {
    return {
      id: message.id,
      chatJid: message.chat_jid,
      fromMe: Boolean(message.from_me),
      text: message.text,
      type: message.message_type,
      timestamp: Number(message.timestamp),
      status: Number(message.status),
      participant: message.participant || "",
    };
  }

  getMessages(jid, offset = 0) {
    const canonicalJid = this.canonicalChatJid(jid);
    const chat = db.prepare("SELECT jid FROM whatsapp_chats WHERE jid = ?").get(canonicalJid);
    if (!chat) return [];
    return db.prepare(`
      SELECT * FROM (
        SELECT rowid AS message_rowid, * FROM whatsapp_messages WHERE chat_jid = ?
        ORDER BY timestamp DESC, rowid DESC LIMIT 100 OFFSET ?
      ) ORDER BY timestamp ASC, message_rowid ASC
    `).all(canonicalJid, offset).map((message) => this.formatMessage(message));
  }

  getPendingMessageStatus(id) {
    const pending = this.pendingMessageStatuses.get(id);
    if (!pending) return 0;
    if (pending.expiresAt <= Date.now()) {
      this.pendingMessageStatuses.delete(id);
      return 0;
    }
    return pending.status;
  }

  updateMessageStatus(id, status) {
    if (!Number.isFinite(status) || status < -1) return;
    const current = db.prepare("SELECT status FROM whatsapp_messages WHERE id = ?").get(id);
    if (!current) {
      const previous = this.getPendingMessageStatus(id);
      const pendingStatus = status === -1 ? -1 : Math.max(previous === -1 ? 0 : previous, status);
      this.pendingMessageStatuses.delete(id);
      this.pendingMessageStatuses.set(id, {
        status: pendingStatus,
        expiresAt: Date.now() + PENDING_STATUS_TTL_MS,
      });
      while (this.pendingMessageStatuses.size > MAX_PENDING_MESSAGE_STATUSES) {
        this.pendingMessageStatuses.delete(this.pendingMessageStatuses.keys().next().value);
      }
      return;
    }
    if (status === -1 && Number(current.status) >= 2) return;
    const nextStatus = status === -1 ? -1 : Math.max(Number(current.status) || 0, status);
    if (nextStatus === Number(current.status)) return;
    db.prepare("UPDATE whatsapp_messages SET status = ? WHERE id = ?").run(nextStatus, id);
    if (nextStatus === -1) {
      db.prepare(`UPDATE whatsapp_send_requests
        SET status = 'failed', error = 'WhatsApp rejeitou a mensagem.', updated_at = CURRENT_TIMESTAMP
        WHERE message_id = ?`).run(id);
    }
    emit("whatsapp:message-update", { id, status: nextStatus });
  }

  async sendText(jid, text, requestId = crypto.randomUUID()) {
    const { chatJid, recipientJid } = await this.resolveOutgoingChatJid(jid);
    const idempotencyKey = String(requestId || "").trim();
    if (!idempotencyKey || idempotencyKey.length > 100) throw new Error("Identificador de envio inválido.");

    const existing = db.prepare("SELECT * FROM whatsapp_send_requests WHERE request_id = ?").get(idempotencyKey);
    if (existing && (existing.chat_jid !== chatJid || existing.text !== text)) {
      throw new Error("Este identificador de envio já foi usado com outra mensagem.");
    }
    if (existing?.status === "sent" && existing.message_id) {
      const saved = db.prepare("SELECT * FROM whatsapp_messages WHERE id = ?").get(existing.message_id);
      if (saved) return this.formatMessage(saved);
      throw new Error("A mensagem já foi enviada, mas ainda não está disponível no histórico. Não tente enviá-la novamente.");
    }
    if (existing?.status === "pending") {
      throw new Error("Este envio já está em andamento. Aguarde antes de tentar novamente.");
    }

    if (existing) {
      db.prepare(`UPDATE whatsapp_send_requests SET status = 'pending', error = '', updated_at = CURRENT_TIMESTAMP
        WHERE request_id = ?`).run(idempotencyKey);
    } else {
      db.prepare(`INSERT INTO whatsapp_send_requests (request_id, chat_jid, text, status)
        VALUES (?, ?, ?, 'pending')`).run(idempotencyKey, chatJid, text);
    }

    if (!this.socket || this.status.state !== "connected") {
      db.prepare(`UPDATE whatsapp_send_requests SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP
        WHERE request_id = ?`).run("WhatsApp não está conectado.", idempotencyKey);
      throw new Error("WhatsApp não está conectado.");
    }

    try {
      const result = await this.socket.sendMessage(recipientJid, { text });
      const messageKey = result?.key;
      if (!messageKey?.id) throw new Error("WhatsApp não confirmou o envio da mensagem.");

      const timestamp = dateFromMessage(result);
      const content = messageContent(result, (message) => Object.keys(message || {})[0]);
      const returnedStatus = Number(result.status);
      const pendingStatus = this.getPendingMessageStatus(messageKey.id);
      const status = pendingStatus === -1
        ? -1
        : Math.max(
          Number.isFinite(returnedStatus) && returnedStatus > 0 ? returnedStatus : 1,
          pendingStatus,
        );
      const save = db.transaction(() => {
        db.prepare(`
          INSERT INTO whatsapp_chats (jid, name, last_message, last_message_at, is_group, updated_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(jid) DO UPDATE SET last_message = excluded.last_message, last_message_at = excluded.last_message_at,
            updated_at = CURRENT_TIMESTAMP
        `).run(chatJid, chatJid.split("@")[0], text, timestamp, chatJid.endsWith("@g.us") ? 1 : 0);
        db.prepare(`
          INSERT OR IGNORE INTO whatsapp_messages (id, chat_jid, from_me, text, message_type, timestamp, status, participant)
          VALUES (?, ?, 1, ?, ?, ?, ?, '')
        `).run(messageKey.id, chatJid, text, content.type || "conversation", timestamp, status);
        if (status > 1) {
          db.prepare("UPDATE whatsapp_messages SET status = MAX(status, ?) WHERE id = ?").run(status, messageKey.id);
        }
        db.prepare(`UPDATE whatsapp_send_requests SET status = 'sent', message_id = ?, error = '', updated_at = CURRENT_TIMESTAMP
          WHERE request_id = ?`).run(messageKey.id, idempotencyKey);
        return db.prepare("SELECT * FROM whatsapp_messages WHERE id = ?").get(messageKey.id);
      });
      const saved = save();
      this.pendingMessageStatuses.delete(messageKey.id);
      const chat = db.prepare("SELECT * FROM whatsapp_chats WHERE jid = ?").get(chatJid);
      emit("whatsapp:message", { chat: this.formatChat(chat), message: this.formatMessage(saved) });
      emit("whatsapp:chats", { chat: this.formatChat(chat) });
      if (Number(saved?.status) === -1) throw new Error("WhatsApp rejeitou a mensagem. Verifique a conversa antes de tentar novamente.");
      return this.formatMessage(saved);
    } catch (error) {
      db.prepare(`UPDATE whatsapp_send_requests SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP
        WHERE request_id = ?`).run(String(error.message || "Falha no envio.").slice(0, 500), idempotencyKey);
      throw error;
    }
  }

  async markRead(jid) {
    const canonicalJid = this.resolveChatAlias(jid) || jid;
    const knownLid = canonicalJid.endsWith("@s.whatsapp.net")
      ? db.prepare(`SELECT alias_jid FROM whatsapp_jid_aliases WHERE canonical_jid = ? AND alias_jid LIKE '%@lid' LIMIT 1`).get(canonicalJid)
      : null;
    const receiptJid = knownLid?.alias_jid || jid;
    const inbound = db.prepare(`
      SELECT id, participant FROM whatsapp_messages WHERE chat_jid = ? AND from_me = 0 ORDER BY timestamp DESC LIMIT 50
    `).all(canonicalJid);
    db.prepare("UPDATE whatsapp_chats SET unread_count = 0 WHERE jid = ?").run(canonicalJid);
    if (this.socket && inbound.length) {
      await this.socket.readMessages(inbound.map((item) => ({
        remoteJid: receiptJid,
        id: item.id,
        fromMe: false,
        ...(item.participant ? { participant: item.participant } : {}),
      }))).catch(() => {});
    }
    const chat = db.prepare("SELECT * FROM whatsapp_chats WHERE jid = ?").get(jid);
    if (chat) emit("whatsapp:chats", { chat: this.formatChat(chat) });
  }
}

export const whatsappService = new WhatsAppService();
