import crypto from "crypto";

const validationCache = new Map();
const CACHE_TTL_MS = 60_000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizedHost(host) {
  return String(host || "").replace(/^\[|\]$/g, "").toLowerCase();
}

function isLoopbackAddress(address) {
  const normalized = String(address || "").toLowerCase().replace(/^::ffff:/, "");
  return normalized === "127.0.0.1" || normalized === "::1";
}

export function isLocalWhatsAppRequest({ origin, host, remoteAddress } = {}) {
  if (!isLoopbackAddress(remoteAddress) || !host) return false;
  let hostUrl;
  let originUrl;
  try {
    hostUrl = new URL(`http://${host}`);
    originUrl = origin ? new URL(origin) : hostUrl;
  } catch {
    return false;
  }
  const hostName = normalizedHost(hostUrl.hostname);
  const originName = normalizedHost(originUrl.hostname);
  return hostUrl.protocol === "http:"
    && originUrl.protocol === "http:"
    && LOCAL_HOSTS.has(hostName)
    && LOCAL_HOSTS.has(originName);
}

function getConfiguration() {
  const appBaseUrl = process.env.BASE44_APP_BASE_URL?.trim();
  const appId = process.env.BASE44_APP_ID?.trim();

  if (!appBaseUrl || !appId) return null;
  return { appBaseUrl: appBaseUrl.replace(/\/$/, ""), appId };
}

async function validateBase44Token(token, appId) {
  const config = getConfiguration();
  if (!config) {
    return { error: "Configure BASE44_APP_BASE_URL e BASE44_APP_ID no backend.", status: 503 };
  }
  if (appId !== config.appId) return { error: "Aplicativo inválido.", status: 401 };

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const cached = validationCache.get(tokenHash);
  if (cached?.expiresAt > Date.now()) return { user: cached.user };

  try {
    const response = await fetch(
      `${config.appBaseUrl}/api/apps/${encodeURIComponent(config.appId)}/entities/User/me`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-App-Id": config.appId,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) return { error: "Sessão SJ expirada ou inválida.", status: 401 };
    const user = await response.json();
    validationCache.set(tokenHash, { user, expiresAt: Date.now() + CACHE_TTL_MS });
    if (validationCache.size > 500) {
      for (const [key, entry] of validationCache) {
        if (entry.expiresAt <= Date.now()) validationCache.delete(key);
      }
    }
    return { user };
  } catch {
    return { error: "Não foi possível validar sua sessão SJ.", status: 503 };
  }
}

export async function authenticateWhatsApp(token, appId, requestContext) {
  if (isLocalWhatsAppRequest(requestContext)) {
    return { user: { id: "local-development" }, local: true };
  }
  if (!token || !appId) return { error: "Autenticação necessária.", status: 401 };
  return validateBase44Token(token, appId);
}

export async function requireWhatsAppAuth(req, res, next) {
  const token = req.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const result = await authenticateWhatsApp(token, req.get("x-app-id"), {
    origin: req.get("origin"),
    host: req.get("host"),
    remoteAddress: req.socket.remoteAddress,
  });
  if (!result.user) return res.status(result.status).json({ error: result.error });
  req.authenticatedUser = result.user;
  next();
}
