const WS_URL = "ws://127.0.0.1:8000/ws/audio";

const toggleBtn = document.getElementById("toggleBtn");
const statusEl = document.getElementById("status");
const eventsEl = document.getElementById("events");
const assistantEl = document.getElementById("assistant");
const customMessageEl = document.getElementById("customMessage");
const sendBtn = document.getElementById("sendBtn");
const customConsoleEl = document.getElementById("customConsole");
const chatMessageEl = document.getElementById("chatMessage");
const chatSendBtn = document.getElementById("chatSendBtn");

let ws = null;
let audioContext = null;
let mediaStream = null;
let sourceNode = null;
let processorNode = null;

let isRunning = false;
let wsConnectPromise = null;
let pendingCustomMessages = [];

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

function requireSecureContextOrThrow() {
  if (window.isSecureContext) return;
  const hint =
    "Microphone access requires a secure context. Open this page via http://localhost (not file://).";
  throw new Error(hint);
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

async function logAudioDeviceInfo() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    appendTranscript("enumerateDevices() not available in this browser context.");
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === "audioinput");
    const outputs = devices.filter((d) => d.kind === "audiooutput");
    appendTranscript(
      `Audio devices: inputs=${inputs.length} outputs=${outputs.length} total=${devices.length}`
    );
  } catch (e) {
    appendTranscript(`enumerateDevices failed: ${String(e?.message || e)}`);
  }
}

function downsampleTo16k(float32, inSampleRate) {
  const outSampleRate = 16000;
  if (inSampleRate === outSampleRate) return float32;

  const ratio = inSampleRate / outSampleRate;
  const outLength = Math.floor(float32.length / ratio);
  const out = new Float32Array(outLength);

  let inOffset = 0;
  for (let i = 0; i < outLength; i++) {
    const nextInOffset = Math.floor((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    while (inOffset < nextInOffset && inOffset < float32.length) {
      sum += float32[inOffset++];
      count++;
    }
    out[i] = count > 0 ? sum / count : 0;
  }

  return out;
}

async function start() {
  if (isRunning) return;
  isRunning = true;
  toggleBtn.textContent = "Stop";
  toggleBtn.classList.add("running");

  setStatus("Connecting…");
  if (eventsEl) eventsEl.innerHTML = "";
  if (customConsoleEl) customConsoleEl.innerHTML = "";
  assistantEl.value = "";

  try {
    requireSecureContextOrThrow();
  } catch (e) {
    appendTranscript(String(e?.message || e));
    setStatus("Mic blocked (insecure context)");
    stop(false);
    return;
  }

  let hasMic = false;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    appendTranscript("getUserMedia is not available in this browser context.");
  } else {
    await logAudioDeviceInfo();

    setStatus("Requesting mic permission…");
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      hasMic = true;
    } catch (e) {
      if (e?.name === "NotFoundError" || e?.name === "DevicesNotFoundError") {
        appendTranscript(
          "Microphone not found (no input device). You can still connect to the backend, but audio streaming/STT will be disabled."
        );
      }
      appendTranscript(
        `Microphone permission failed: ${String(e?.name || "Error")} ${String(
          e?.message || e
        )}`
      );
    }
  }

  setStatus("Connecting…");

  const localWs = new WebSocket(WS_URL);
  ws = localWs;
  attachWsHandlers(localWs);

  localWs.onopen = () => {
    if (!isRunning || ws !== localWs || localWs.readyState !== WebSocket.OPEN) {
      return;
    }
    localWs.send(
      JSON.stringify({
        event: "client.started",
        audio_enabled: hasMic,
        audio: hasMic ? { format: "f32le", sample_rate: 16000, channels: 1 } : null,
      })
    );
    setStatus(hasMic ? "Listening…" : "Connected (no mic)" );
    setSendEnabled(true);
  };

  localWs.onclose = () => {
    if (ws === localWs) stop(true);
  };

  if (hasMic) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    sourceNode = audioContext.createMediaStreamSource(mediaStream);

    const bufferSize = 4096;
    processorNode = audioContext.createScriptProcessor(bufferSize, 1, 1);

    processorNode.onaudioprocess = (e) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const input = e.inputBuffer.getChannelData(0);
      const down = downsampleTo16k(input, audioContext.sampleRate);

      ws.send(down.buffer);
    };

    sourceNode.connect(processorNode);
    processorNode.connect(audioContext.destination);

    setStatus("Mic ready. Waiting for WS…");
  } else {
    setStatus("Connecting…");
  }
}

async function stop(fromSocketClose = false) {
  if (!isRunning) return;
  isRunning = false;
  toggleBtn.textContent = "Start";
  toggleBtn.classList.remove("running");

  if (!fromSocketClose) {
    try {
      ws?.send(JSON.stringify({ event: "client.stopped" }));
    } catch {}
  }

  try {
    processorNode?.disconnect();
  } catch {}
  try {
    sourceNode?.disconnect();
  } catch {}

  processorNode = null;
  sourceNode = null;

  if (mediaStream) {
    for (const track of mediaStream.getTracks()) track.stop();
  }
  mediaStream = null;

  if (audioContext) {
    try {
      await audioContext.close();
    } catch {}
  }
  audioContext = null;

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
  ws = null;
  wsConnectPromise = null;
  pendingCustomMessages = [];

  setSendEnabled(false);

  setStatus("Idle");
}

toggleBtn.addEventListener("click", () => {
  if (isRunning) stop(false);
  else start();
});
