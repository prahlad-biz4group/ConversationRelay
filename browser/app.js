const WS_URL = "ws://127.0.0.1:8000/ws/audio";

const statusEl = document.getElementById("status");
const eventsEl = document.getElementById("events");
const assistantEl = document.getElementById("assistant");
const customMessageEl = document.getElementById("customMessage");
const sendBtn = document.getElementById("sendBtn");
const customConsoleEl = document.getElementById("customConsole");
const chatMessageEl = document.getElementById("chatMessage");
const chatSendBtn = document.getElementById("chatSendBtn");

let ws = null;
let wsConnectPromise = null;
let pendingCustomMessages = [];

let activeAssistantMessageId = null;
let activeAssistantBuffer = "";
let activeAssistantPrefix = "";

function wsReady() {
  return ws && ws.readyState === WebSocket.OPEN;
}

function sendChatToAI() {
  const text = (chatMessageEl?.value || "").trim();
  if (!text) return;
  chatMessageEl.value = "";

  const doSend = () => {
    try {
      ws.send(JSON.stringify({ event: "client.text.message", text }));
      addEventCard({ event: "client.text.message.sent", data: { text } });
    } catch {
      appendTranscript("Failed to send chat message.");
    }
  };

  if (!wsReady()) {
    ensureWsConnected()
      .then(() => doSend())
      .catch(() => appendTranscript("Failed to connect WebSocket."));
    return;
  }

  doSend();
}

function addCustomConsoleCard(msg) {
  if (!customConsoleEl) return;

  const card = document.createElement("div");
  card.className = "event-card";

  const header = document.createElement("div");
  header.className = "event-header";

  const name = document.createElement("div");
  name.className = "event-name";
  name.textContent = msg?.event || "(no event)";

  const meta = document.createElement("div");
  meta.className = "event-meta";
  meta.textContent = new Date().toLocaleTimeString();

  const body = document.createElement("div");
  body.className = "event-body";
  body.textContent = prettyJson(msg);

  header.appendChild(name);
  header.appendChild(meta);
  card.appendChild(header);
  card.appendChild(body);
  customConsoleEl.appendChild(card);
  customConsoleEl.scrollTop = customConsoleEl.scrollHeight;
}

function setSendEnabled(enabled) {
  if (sendBtn) sendBtn.disabled = false;
}

function attachWsHandlers(localWs) {
  localWs.binaryType = "arraybuffer";

  localWs.onmessage = (ev) => {
    if (typeof ev.data === "string") {
      try {
        const msg = JSON.parse(ev.data);
        const eventName = msg.event || "(no event)";

        if (eventName === "server.custom.message") {
          addCustomConsoleCard(msg);
        }

        if (eventName === "assistant.response") {
          appendAssistant(msg.text || JSON.stringify(msg));
        } else if (eventName === "assistant.message.started") {
          activeAssistantMessageId = msg.message_id || null;
          activeAssistantBuffer = "";
          // Snapshot current text; stream will update textarea with prefix + buffer
          activeAssistantPrefix = assistantEl.value;
          if (activeAssistantPrefix && !activeAssistantPrefix.endsWith("\n")) {
            activeAssistantPrefix += "\n";
          }
          assistantEl.value = activeAssistantPrefix;
        } else if (eventName === "assistant.message.delta") {
          if (!activeAssistantMessageId) {
            activeAssistantMessageId = msg.message_id || null;
          }
          if (msg.message_id && activeAssistantMessageId && msg.message_id !== activeAssistantMessageId) {
            // Ignore deltas from an old message if we already switched.
            return;
          }
          appendAssistantStream(String(msg.delta || ""));
        } else if (eventName === "assistant.message.completed") {
          if (msg.message_id && activeAssistantMessageId && msg.message_id !== activeAssistantMessageId) {
            return;
          }
          activeAssistantMessageId = null;
          activeAssistantBuffer = "";
          activeAssistantPrefix = assistantEl.value;
          if (activeAssistantPrefix && !activeAssistantPrefix.endsWith("\n")) {
            assistantEl.value += "\n";
          }
          assistantEl.scrollTop = assistantEl.scrollHeight;
        } else if (eventName === "assistant.message.cancelled") {
          if (msg.message_id && activeAssistantMessageId && msg.message_id !== activeAssistantMessageId) {
            return;
          }
          activeAssistantMessageId = null;
          activeAssistantBuffer = "";
          activeAssistantPrefix = assistantEl.value;
          if (activeAssistantPrefix && !activeAssistantPrefix.endsWith("\n")) {
            assistantEl.value += "\n";
          }
          assistantEl.scrollTop = assistantEl.scrollHeight;
        } else {
          addEventCard(msg);
        }

        if (eventName === "session.started") {
          setStatus(`Connected (conversation_id=${msg.conversation_id})`);
        }
      } catch {
        appendTranscript(ev.data);
      }
      return;
    }

    addEventCard({ event: "server.binary", data: { bytes: ev.data.byteLength } });
  };

  localWs.onclose = () => {
    if (ws === localWs) {
      ws = null;
      wsConnectPromise = null;
      setStatus("Idle");
    }
  };

  localWs.onerror = () => {
    appendTranscript("WebSocket error (is the backend running on 127.0.0.1:8000?)");
  };
}

async function ensureWsConnected() {
  if (wsReady()) return;

  if (wsConnectPromise) {
    await wsConnectPromise;
    return;
  }

  setStatus("Connecting…");
  addEventCard({ event: "ui.ws.connecting" });

  wsConnectPromise = new Promise((resolve, reject) => {
    const localWs = new WebSocket(WS_URL);
    ws = localWs;
    attachWsHandlers(localWs);

    localWs.onopen = () => {
      try {
        localWs.send(
          JSON.stringify({
            event: "client.started",
            audio_enabled: false,
            audio: null,
          })
        );
      } catch {}

      setStatus("Connected");
      addEventCard({ event: "ui.ws.connected" });
      setSendEnabled(true);

      const queued = pendingCustomMessages;
      pendingCustomMessages = [];
      for (const text of queued) {
        try {
          localWs.send(JSON.stringify({ event: "client.custom.message", text }));
          addEventCard({ event: "client.custom.message.sent", data: { text } });
          addCustomConsoleCard({ event: "client.custom.message.sent", text });
        } catch {}
      }

      wsConnectPromise = null;
      resolve();
    };

    localWs.onerror = (e) => {
      wsConnectPromise = null;
      reject(e);
    };
  });

  await wsConnectPromise;
}

function sendCustomMessage() {
  const text = (customMessageEl?.value || "").trim();
  if (!text) return;

  customMessageEl.value = "";

  if (!wsReady()) {
    pendingCustomMessages.push(text);
    ensureWsConnected().catch(() => {
      appendTranscript("Failed to connect WebSocket.");
    });
    return;
  }

  ws.send(JSON.stringify({ event: "client.custom.message", text }));
  addEventCard({ event: "client.custom.message.sent", data: { text } });
  addCustomConsoleCard({ event: "client.custom.message.sent", text });
}

sendBtn?.addEventListener("click", () => sendCustomMessage());

chatSendBtn?.addEventListener("click", () => sendChatToAI());

customMessageEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendCustomMessage();
  }
});

chatMessageEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendChatToAI();
  }
});

function setStatus(text) {
  statusEl.textContent = text;
}

function appendTranscript(line) {
  addEventCard({ event: "ui.log", data: { message: String(line) } });
}

function appendAssistant(line) {
  assistantEl.value += line + "\n";
  assistantEl.scrollTop = assistantEl.scrollHeight;
}

function appendAssistantStream(delta) {
  activeAssistantBuffer += delta;
  assistantEl.value = activeAssistantPrefix + activeAssistantBuffer;
  assistantEl.scrollTop = assistantEl.scrollHeight;
}

function prettyJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function addEventCard(msg) {
  if (!eventsEl) return;

  const card = document.createElement("div");
  card.className = "event-card";

  const header = document.createElement("div");
  header.className = "event-header";

  const name = document.createElement("div");
  name.className = "event-name";
  name.textContent = msg?.event || "(no event)";

  const meta = document.createElement("div");
  meta.className = "event-meta";
  const parts = [];
  if (msg?.seq != null) parts.push(`seq=${msg.seq}`);
  if (msg?.conversation_id) parts.push(`cid=${msg.conversation_id}`);
  parts.push(new Date().toLocaleTimeString());
  meta.textContent = parts.join(" · ");

  const body = document.createElement("div");
  body.className = "event-body";

  const cloned = { ...msg };
  delete cloned.event;
  delete cloned.seq;
  delete cloned.conversation_id;
  body.textContent = Object.keys(cloned).length ? prettyJson(cloned) : "";

  header.appendChild(name);
  header.appendChild(meta);
  card.appendChild(header);
  card.appendChild(body);
  eventsEl.appendChild(card);
  eventsEl.scrollTop = eventsEl.scrollHeight;
}
