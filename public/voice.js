// "Talk to Vera" — in-browser voice shopping via the Vapi Web SDK
import VapiModule from "https://cdn.jsdelivr.net/npm/@vapi-ai/web@2/+esm";

// The CDN build wraps the CommonJS export, so the class may sit one level deeper
const Vapi = VapiModule.default || VapiModule;

const css = `
.vv-btn{position:fixed;right:24px;bottom:24px;z-index:60;display:flex;align-items:center;gap:10px;
  padding:14px 20px;border:0;border-radius:999px;background:var(--ink,#111);color:#fff;font:inherit;
  font-size:15px;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.18)}
.vv-btn .dot{width:12px;height:12px;border-radius:50%;background:var(--lime,#d6ee9b)}
.vv-btn.live{background:#b3261e}.vv-btn.live .dot{background:#fff;animation:vvp 1s infinite}
.vv-btn.talking .dot{transform:scale(1.5)}
.vv-panel{position:fixed;right:24px;bottom:88px;z-index:60;width:min(360px,calc(100vw - 32px));max-height:50vh;
  overflow:auto;background:var(--card,#fff);border:1px solid var(--line,#e4e1db);border-radius:20px;
  padding:16px;box-shadow:0 10px 30px rgba(0,0,0,.12);font-size:14px;display:none}
.vv-panel.open{display:block}
.vv-panel .st{color:var(--muted,#5d5a55);margin-bottom:8px}
.vv-panel p{margin:6px 0;line-height:1.4}.vv-panel b{font-weight:600}
.vv-pay{display:block;margin-top:10px;padding:12px;border-radius:999px;background:var(--ink,#111);color:#fff!important;
  text-align:center;text-decoration:none!important;font-weight:600}
.vv-panel a{color:inherit;text-decoration:underline;word-break:break-all}
@keyframes vvp{50%{opacity:.4}}
@media (max-width:600px){.vv-btn{right:16px;bottom:16px}.vv-panel{right:16px;bottom:80px}}
`;
document.head.insertAdjacentHTML("beforeend", `<style>${css}</style>`);

const btn = document.createElement("button");
btn.className = "vv-btn";
btn.innerHTML = `<span class="dot"></span><span class="lbl">Talk to Vera</span>`;
const panel = document.createElement("div");
panel.className = "vv-panel";
panel.innerHTML = `<div class="st">Ready</div><div class="log"></div>`;
document.body.append(panel, btn);

const lbl = btn.querySelector(".lbl");
const st = panel.querySelector(".st");
const log = panel.querySelector(".log");

let vapi = null;
let assistantId = "";
let live = false;
let connecting = false;

function setStatus(text) { st.textContent = text; }

function linkify(text) {
  const esc = text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  return esc.replace(/https?:\/\/[^\s)]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
}

function addLine(role, text) {
  const p = document.createElement("p");
  p.innerHTML = `<b>${role === "user" ? "You" : "Vera"}:</b> ${linkify(text)}`;
  log.append(p);
  panel.scrollTop = panel.scrollHeight;
}

let paymentUrl = "";
function showPayment(url) {
  if (url === paymentUrl) return;
  paymentUrl = url;
  const a = document.createElement("a");
  a.className = "vv-pay";
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = "Complete payment";
  log.append(a);
  panel.classList.add("open");
  panel.scrollTop = panel.scrollHeight;
}

function setLive(on) {
  live = on;
  connecting = false;
  btn.classList.toggle("live", on);
  lbl.textContent = on ? "End call" : "Talk to Vera";
  setStatus(on ? "Listening… just speak naturally" : "Call ended");
}

async function setup() {
  const res = await fetch("/api/shop/config");
  const cfg = await res.json();
  if (!cfg.vapiPublicKey || !cfg.vapiAssistantId) throw new Error("Voice is not configured");
  assistantId = cfg.vapiAssistantId;
  vapi = new Vapi(cfg.vapiPublicKey);

  vapi.on("call-start", () => setLive(true));
  vapi.on("call-end", () => setLive(false));
  vapi.on("speech-start", () => btn.classList.add("talking"));
  vapi.on("speech-end", () => btn.classList.remove("talking"));
  vapi.on("message", (m) => {
    if (m.type === "transcript" && m.transcriptType === "final") addLine(m.role, m.transcript);
    // confirm-order returns a Paystack checkout URL in its tool result
    const url = JSON.stringify(m).match(/https:\/\/checkout\.paystack\.com\/[A-Za-z0-9]+/);
    if (url) showPayment(url[0]);
  });
  vapi.on("error", (e) => {
    console.error("Vapi error", e);
    setStatus("Something went wrong. Please try again.");
    setLive(false);
  });
}

async function toggle() {
  panel.classList.add("open");
  if (connecting) return;
  if (live) { vapi.stop(); return; }
  connecting = true;
  setStatus("Connecting… allow microphone access");
  try {
    if (!vapi) await setup();
    log.innerHTML = "";
    paymentUrl = "";
    await vapi.start(assistantId);
  } catch (e) {
    console.error(e);
    connecting = false;
    setStatus(e.message || "Could not start the call");
  }
}

btn.addEventListener("click", toggle);
window.VeraVoice = { toggle };

// Wake the backend (free Render instances sleep when idle) as soon as the page
// opens, and keep it awake while the tab stays visible.
function wakeBackend() {
  fetch("/api/shop/config", { cache: "no-store" }).catch(() => {});
}
wakeBackend();
setInterval(() => {
  if (document.visibilityState === "visible") wakeBackend();
}, 10 * 60 * 1000);
