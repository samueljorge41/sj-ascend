import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCheck,
  CircleDashed,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  QrCode,
  RefreshCw,
  Search,
  Send,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  connectWhatsApp,
  getWhatsAppChats,
  getWhatsAppCredentials,
  getWhatsAppMessages,
  getWhatsAppStatus,
  markWhatsAppChatRead,
  sendWhatsAppMessage,
} from "@/api/whatsapp";

const STATUS_LABELS = {
  connected: "Conectado",
  connecting: "Conectando",
  disconnected: "Desconectado",
  qr: "Aguardando leitura do QR Code",
  error: "Configuração necessária",
};

function formatTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp * 1000);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(date);
}

function formatMessageTime(timestamp) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp * 1000));
}

function initials(name = "?") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function Avatar({ chat, size = "h-12 w-12" }) {
  return (
    <div className={`${size} flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#dceee7] text-sm font-semibold text-[#176b55] dark:bg-emerald-950 dark:text-emerald-200`}>
      {chat.avatarUrl ? <img src={chat.avatarUrl} alt="" className="h-full w-full object-cover" /> : initials(chat.name)}
    </div>
  );
}

function StatusIndicator({ status }) {
  if (status < 0) return <AlertCircle className="h-4 w-4 text-destructive" aria-label="Falha no envio" />;
  if (status >= 4) return <CheckCheck className="h-4 w-4 text-sky-500" aria-label="Lida" />;
  if (status >= 3) return <CheckCheck className="h-4 w-4 text-muted-foreground" aria-label="Entregue" />;
  if (status >= 2) return <Check className="h-4 w-4 text-muted-foreground" aria-label="Enviada" />;
  return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" aria-label="Enviando" />;
}

function ConnectionScreen({ status, onConnect, error }) {
  const configurationError = status.errorCode === "session_key_missing";
  const isQr = status.state === "qr" && status.qr;
  const isConnecting = status.state === "connecting";

  return (
    <div className="flex min-h-[560px] flex-1 items-center justify-center bg-[#f7f9f8] p-6 dark:bg-[#101916]">
      <div className="w-full max-w-md rounded-2xl border bg-card p-7 text-center shadow-sm sm:p-9">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          {isConnecting ? <LoaderCircle className="h-7 w-7 animate-spin" /> : isQr ? <QrCode className="h-7 w-7" /> : <WifiOff className="h-7 w-7" />}
        </div>
        <h2 className="text-xl font-semibold">{isQr ? "Conecte seu WhatsApp" : isConnecting ? "Conectando ao WhatsApp" : configurationError ? "WhatsApp precisa ser configurado" : "WhatsApp desconectado"}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {isQr
            ? "No celular, abra o WhatsApp, acesse Aparelhos conectados e escolha Conectar aparelho."
            : isConnecting
              ? "Estamos verificando a sessão salva ou preparando um novo QR Code."
              : configurationError
                ? status.error
                : error || status.error || "A sessão será reconectada automaticamente. Você também pode tentar agora."}
        </p>
        {isQr && (
          <div className="mx-auto mt-6 flex w-fit items-center justify-center rounded-xl border bg-white p-3 shadow-sm">
            <img src={status.qr} alt="QR Code para conectar o WhatsApp" className="h-64 w-64" />
          </div>
        )}
        {isQr && <p className="mt-4 text-xs text-muted-foreground">O código é temporário e será atualizado automaticamente quando expirar.</p>}
        {!isQr && !isConnecting && !configurationError && (
          <button onClick={onConnect} className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#128c65] px-5 text-sm font-medium text-white transition hover:bg-[#0e7957]">
            <RefreshCw className="h-4 w-4" />
            Tentar conectar
          </button>
        )}
        {error && !configurationError && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}

export default function WhatsApp() {
  const [status, setStatus] = useState({ state: "connecting", qr: null, error: null });
  const [error, setError] = useState("");
  const [chats, setChats] = useState([]);
  const [search, setSearch] = useState("");
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [listError, setListError] = useState("");
  const [chatError, setChatError] = useState("");
  const socketRef = useRef(null);
  const messageListRef = useRef(null);
  const messageCountRef = useRef(0);
  const selectedJidRef = useRef(null);
  const searchRef = useRef(search);
  const preserveScrollRef = useRef(false);
  const statusEventCountRef = useRef(0);

  selectedJidRef.current = activeChat?.jid || null;
  searchRef.current = search;

  const loadChats = useCallback(async (term = searchRef.current) => {
    try {
      const nextChats = await getWhatsAppChats(term);
      setChats(nextChats);
      setListError("");
    } catch (loadError) {
      setListError(loadError.message);
    }
  }, []);

  const mergeMessage = useCallback((message) => {
    setMessages((current) => current.some((item) => item.id === message.id)
      ? current.map((item) => item.id === message.id
        ? { ...item, ...message, status: Math.max(Number(item.status) || 0, Number(message.status) || 0) }
        : item)
      : [...current, message].sort((a, b) => a.timestamp - b.timestamp));
  }, []);

  const refreshActiveMessages = useCallback(async (jid) => {
    const result = await getWhatsAppMessages(jid);
    if (selectedJidRef.current !== jid && selectedJidRef.current !== result.jid) return;
    if (result.jid !== jid) {
      setActiveChat((current) => current?.jid === jid ? { ...current, jid: result.jid } : current);
    }
    setMessages((current) => {
      const merged = new Map(current.map((message) => [message.id, message]));
      for (const message of result.messages) {
        const existing = merged.get(message.id);
        merged.set(message.id, {
          ...existing,
          ...message,
          status: Math.max(Number(existing?.status) || 0, Number(message.status) || 0),
        });
      }
      return [...merged.values()].sort((left, right) => left.timestamp - right.timestamp);
    });
  }, []);

  useEffect(() => {
    let alive = true;
    const socket = io({ auth: getWhatsAppCredentials(), transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      void loadChats();
      const jid = selectedJidRef.current;
      if (jid) void refreshActiveMessages(jid).catch(() => {});
    });
    socket.on("connect_error", (socketError) => {
      if (alive && socketError.message) setError(socketError.message);
    });
    socket.on("whatsapp:status", (nextStatus) => {
      if (alive) {
        statusEventCountRef.current += 1;
        setStatus(nextStatus);
        setError("");
      }
    });
    socket.on("whatsapp:chats", () => {
      if (alive) void loadChats();
    });
    socket.on("whatsapp:message", ({ chat, message }) => {
      if (!alive) return;
      if (chat) {
        setChats((current) => [chat, ...current.filter((item) => item.jid !== chat.jid)]);
        if (chat.jid === selectedJidRef.current && !message.fromMe) {
          void markWhatsAppChatRead(chat.jid);
        }
      }
      if (message.chatJid === selectedJidRef.current) mergeMessage(message);
    });
    socket.on("whatsapp:message-update", (update) => {
      if (alive) setMessages((current) => current.map((message) => message.id === update.id
        ? { ...message, status: Math.max(Number(message.status) || 0, Number(update.status) || 0) }
        : message));
    });

    const startingStatusEvent = statusEventCountRef.current;
    getWhatsAppStatus()
      .then((nextStatus) => {
        if (!alive) return;
        if (statusEventCountRef.current === startingStatusEvent) setStatus(nextStatus);
        if (nextStatus.state === "disconnected") {
          const connectingStatusEvent = statusEventCountRef.current;
          connectWhatsApp().then((connectingStatus) => {
            if (statusEventCountRef.current === connectingStatusEvent) setStatus(connectingStatus);
          }).catch((connectError) => setError(connectError.message));
        }
      })
      .catch((loadError) => {
        if (alive) setError(loadError.message);
      });

    return () => {
      alive = false;
      socket.disconnect();
      socketRef.current = null;
    };
  }, [loadChats, mergeMessage, refreshActiveMessages]);

  useEffect(() => {
    if (status.state !== "connected") return undefined;
    const timer = window.setTimeout(() => { void loadChats(search); }, 150);
    return () => window.clearTimeout(timer);
  }, [status.state, search, loadChats]);

  useEffect(() => {
    if (!activeChat) {
      setMessages([]);
      setHasOlder(false);
      return undefined;
    }
    let alive = true;
    setLoadingMessages(true);
    setChatError("");
    messageCountRef.current = 0;
    preserveScrollRef.current = false;
    setMessages([]);
    getWhatsAppMessages(activeChat.jid)
      .then((result) => {
        if (!alive) return;
        if (result.jid !== activeChat.jid) {
          setActiveChat((current) => current?.jid === activeChat.jid ? { ...current, jid: result.jid } : current);
        }
        setMessages((current) => {
          const incoming = new Map(current.map((message) => [message.id, message]));
          for (const message of result.messages) incoming.set(message.id, { ...incoming.get(message.id), ...message });
          return [...incoming.values()].sort((left, right) => left.timestamp - right.timestamp);
        });
        setHasOlder(result.messages.length === 100);
        void markWhatsAppChatRead(result.jid);
      })
      .catch((loadError) => {
        if (alive) setChatError(loadError.message);
      })
      .finally(() => { if (alive) setLoadingMessages(false); });
    return () => { alive = false; };
  }, [activeChat?.jid]);

  useEffect(() => {
    if (!activeChat) return undefined;

    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setActiveChat(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeChat?.jid]);

  useEffect(() => {
    if (!activeChat || status.state !== "connected") return undefined;
    const timer = window.setInterval(() => {
      void refreshActiveMessages(activeChat.jid).catch(() => {});
    }, 8_000);
    return () => window.clearInterval(timer);
  }, [activeChat?.jid, status.state, refreshActiveMessages]);

  useEffect(() => {
    const list = messageListRef.current;
    if (!list || messages.length === 0) return;
    if (messageCountRef.current !== messages.length) {
      if (preserveScrollRef.current) {
        list.scrollTop += list.scrollHeight - (list.dataset.previousHeight ? Number(list.dataset.previousHeight) : list.scrollHeight);
        preserveScrollRef.current = false;
      } else {
        list.scrollTop = list.scrollHeight;
      }
    }
    messageCountRef.current = messages.length;
  }, [messages]);

  const filteredChats = useMemo(() => chats, [chats]);

  const handleConnect = async () => {
    setError("");
    const startingStatusEvent = statusEventCountRef.current;
    try {
      const nextStatus = await connectWhatsApp();
      if (statusEventCountRef.current === startingStatusEvent) setStatus(nextStatus);
    } catch (connectError) {
      setError(connectError.message);
    }
  };

  const handleSelectChat = (chat) => {
    setActiveChat(chat);
    setChats((current) => current.map((item) => item.jid === chat.jid ? { ...item, unreadCount: 0 } : item));
  };

  const handleLoadOlder = async () => {
    if (!activeChat || loadingOlder) return;
    setLoadingOlder(true);
    if (messageListRef.current) {
      messageListRef.current.dataset.previousHeight = String(messageListRef.current.scrollHeight);
      preserveScrollRef.current = true;
    }
    try {
      const result = await getWhatsAppMessages(activeChat.jid, messages.length);
      if (result.jid !== activeChat.jid) {
        setActiveChat((current) => current?.jid === activeChat.jid ? { ...current, jid: result.jid } : current);
      }
      setMessages((current) => [...result.messages, ...current]);
      setHasOlder(result.messages.length === 100);
    } catch (loadError) {
      setChatError(loadError.message);
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleSend = async (event) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!activeChat || !text || sending) return;
    setSending(true);
    setChatError("");
    try {
      const message = await sendWhatsAppMessage(activeChat.jid, text);
      mergeMessage(message);
      setDraft("");
    } catch (sendError) {
      setChatError(sendError.message);
    } finally {
      setSending(false);
    }
  };

  if (status.state !== "connected") {
    return (
      <section className="flex min-h-screen flex-col bg-background">
        <header className="flex h-16 shrink-0 items-center justify-between border-b px-5 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-[#128c65] dark:bg-emerald-950"><MessageCircle className="h-5 w-5" /></div>
            <div><h1 className="font-semibold">WhatsApp</h1><p className="text-xs text-muted-foreground">{STATUS_LABELS[status.state] || status.state}</p></div>
          </div>
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${status.state === "qr" ? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200" : "bg-muted text-muted-foreground"}`}>
            {status.state === "connecting" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <WifiOff className="h-3.5 w-3.5" />}
            {STATUS_LABELS[status.state] || "Desconectado"}
          </span>
        </header>
        <ConnectionScreen status={status} onConnect={handleConnect} error={error} />
      </section>
    );
  }

  return (
    <section className="flex h-[100dvh] min-h-[560px] flex-col overflow-hidden bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-[#128c65] dark:bg-emerald-950"><MessageCircle className="h-5 w-5" /></div>
          <div><h1 className="font-semibold">WhatsApp</h1><p className="text-xs text-muted-foreground">Suas conversas no SJ Mídias</p></div>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
          <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-40" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" /></span>
          <span className="hidden sm:inline">Conectado{status.phone ? ` · ${status.phone}` : ""}</span>
          <button onClick={handleConnect} title="Atualizar conexão" className="ml-1 rounded-md p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"><RefreshCw className="h-4 w-4" /></button>
          <button title="Mais opções" className="rounded-md p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"><MoreHorizontal className="h-5 w-5" /></button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 border-b">
        <aside className={`${activeChat ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-r bg-card md:w-[340px] lg:w-[390px]`}>
          <div className="border-b px-4 pb-3 pt-4">
            <h2 className="mb-3 text-lg font-semibold">Conversas</h2>
            <label className="flex h-10 items-center gap-2 rounded-lg bg-muted/70 px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
              <Search className="h-4 w-4 shrink-0" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar ou começar uma conversa" className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
            </label>
          </div>
          {listError && <p role="alert" className="px-4 py-2 text-xs text-destructive">{listError}</p>}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredChats.map((chat) => {
              const selected = chat.jid === activeChat?.jid;
              return (
                <button key={chat.jid} onClick={() => handleSelectChat(chat)} className={`flex w-full items-center gap-3 border-b px-4 py-3 text-left transition ${selected ? "bg-muted/80" : "hover:bg-muted/50"}`}>
                  <Avatar chat={chat} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{chat.name}</span><span className={`shrink-0 text-[11px] ${chat.unreadCount ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}>{formatTime(chat.lastMessageAt)}</span></span>
                    <span className="mt-1 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">{chat.lastMessage || (chat.isContact ? "Iniciar conversa" : chat.isGroup ? "Grupo" : "Contato")}</span>
                      {chat.unreadCount > 0 && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#128c65] px-1.5 text-[10px] font-semibold text-white">{chat.unreadCount > 99 ? "99+" : chat.unreadCount}</span>}
                    </span>
                  </span>
                </button>
              );
            })}
            {!listError && filteredChats.length === 0 && <div className="px-6 py-12 text-center text-sm text-muted-foreground">{search ? "Nenhuma conversa encontrada." : "As conversas aparecerão aqui quando sincronizarem."}</div>}
          </div>
          <div className="flex items-center gap-2 border-t px-4 py-3 text-[11px] text-muted-foreground"><Wifi className="h-3.5 w-3.5 text-emerald-600" /> Conexão protegida pela sessão atual do SJ</div>
        </aside>

        <div className={`${activeChat ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col bg-[#f8faf9] dark:bg-[#101916]`}>
          {activeChat ? (
            <>
              <header className="flex h-[68px] shrink-0 items-center gap-3 border-b bg-card px-3 sm:px-5">
                <button onClick={() => setActiveChat(null)} className="rounded-md p-2 text-muted-foreground hover:bg-accent md:hidden" aria-label="Voltar às conversas"><ArrowLeft className="h-5 w-5" /></button>
                <Avatar chat={activeChat} size="h-10 w-10" />
                <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{activeChat.name}</h2><p className="truncate text-xs text-muted-foreground">{activeChat.isGroup ? "Grupo" : activeChat.jid.split("@")[0]}</p></div>
                <button title="Pesquisar nesta conversa" className="rounded-md p-2 text-muted-foreground hover:bg-accent"><Search className="h-5 w-5" /></button>
                <button title="Mais opções" className="rounded-md p-2 text-muted-foreground hover:bg-accent"><MoreHorizontal className="h-5 w-5" /></button>
              </header>
              <div ref={messageListRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-7">
                {hasOlder && <div className="mb-4 text-center"><button onClick={handleLoadOlder} disabled={loadingOlder} className="rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-60">{loadingOlder ? "Carregando…" : "Carregar mensagens anteriores"}</button></div>}
                {loadingMessages && <div className="flex justify-center py-12"><LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
                {!loadingMessages && messages.length === 0 && <div className="mx-auto mt-12 max-w-xs rounded-xl border bg-card/90 px-5 py-4 text-center text-sm text-muted-foreground">As mensagens sincronizadas desta conversa aparecerão aqui.</div>}
                <div className="mx-auto flex max-w-4xl flex-col gap-2">
                  {messages.map((message) => (
                    <div key={message.id} className={`flex ${message.fromMe ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[88%] rounded-2xl px-3.5 py-2 shadow-sm sm:max-w-[75%] ${message.fromMe ? "rounded-tr-sm bg-[#d9fdd3] text-[#173b2d] dark:bg-[#174b3c] dark:text-emerald-50" : "rounded-tl-sm border bg-card text-card-foreground"}`}>
                        {activeChat.isGroup && !message.fromMe && message.participant && <div className="mb-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">{message.participant.split("@")[0]}</div>}
                        <p className="whitespace-pre-wrap break-words text-sm leading-5">{message.text}</p>
                        <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground"><span>{formatMessageTime(message.timestamp)}</span>{message.fromMe && <StatusIndicator status={message.status} />}</div>
                      </div>
                    </div>
                  ))}
                  <div aria-hidden="true" className="h-px" />
                </div>
              </div>
              {chatError && <p role="alert" className="border-t bg-card px-4 py-2 text-sm text-destructive">{chatError}</p>}
              <form onSubmit={handleSend} className="flex shrink-0 items-end gap-2 border-t bg-card px-3 py-3 sm:gap-3 sm:px-5">
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) handleSend(event); }} rows={1} maxLength={4096} placeholder="Digite uma mensagem" aria-label="Mensagem" className="max-h-32 min-h-11 flex-1 resize-y rounded-xl border bg-muted/60 px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-emerald-600/30" />
                <button type="submit" disabled={!draft.trim() || sending} aria-label="Enviar mensagem" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#128c65] text-white transition hover:bg-[#0e7957] disabled:cursor-not-allowed disabled:opacity-50">{sending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button>
              </form>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center">
              <div className="max-w-sm"><div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-[#128c65] dark:bg-emerald-950"><MessageCircle className="h-9 w-9" /></div><h2 className="text-xl font-medium">Mantenha suas conversas por perto</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Selecione uma conversa para ver as mensagens e responder sem sair do SJ Mídias.</p><div className="mt-5 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"><Wifi className="h-3.5 w-3.5" /> WhatsApp conectado</div></div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
