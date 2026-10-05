// Shared storefront helpers: cart, formatting, product art, header
const Vera = (() => {
  const CART_KEY = "vera_cart";
  let currency = "NGN";
  let guestState = null;
  let syncQueue = Promise.resolve();
  function checkoutKey() {
    let key = sessionStorage.getItem("vera_checkout_key");
    if (!key) { key = crypto.randomUUID(); sessionStorage.setItem("vera_checkout_key", key); }
    return key;
  }
  async function syncGuest() {
    await syncQueue;
    const data = await api("/api/guest");
    guestState = data;
    writeCart(data.cart, false);
    return data;
  }

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const money = (n) =>
    new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

  function readCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return []; }
  }
  function writeCart(items, persist = true) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch {}
    renderBagCount();
    window.dispatchEvent(new Event("vera-cart"));
    if (persist) {
      sessionStorage.removeItem("vera_checkout_key");
      if (guestState) guestState.order = null;
      syncQueue = syncQueue.catch(() => {}).then(() => api("/api/guest/cart", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cart: items }) })).catch(() => toast("Cart saved on this device; server sync unavailable"));
    }
  }
  function addToCart(product, quantity = 1) {
    const items = readCart();
    const existing = items.find((i) => i.id === product.id);
    if (existing) existing.quantity = Math.min(99, existing.quantity + quantity);
    else items.push({ id: product.id, name: product.name, price: product.price, color: product.color, category: product.category, quantity });
    writeCart(items);
    toast(`${product.name} added to your bag`);
  }
  function renderBagCount() {
    const n = readCart().reduce((s, i) => s + i.quantity, 0);
    document.querySelectorAll(".bag-count").forEach((el) => (el.textContent = n));
  }

  // Simple packaging illustration per category, tinted with the product colour
  function art(product, label = true) {
    const c = product.color || "#d9e4b8";
    const name = label ? esc((product.name || "").split(" ").slice(0, 2).join(" ").toLowerCase()) : "";
    const shapes = {
      vitamins: `<rect x="40" y="40" width="120" height="22" rx="8" fill="#fff" opacity=".9"/>
        <rect x="32" y="58" width="136" height="150" rx="26" fill="${c}"/>
        <rect x="32" y="58" width="136" height="150" rx="26" fill="url(#g)"/>`,
      hair: `<rect x="86" y="18" width="28" height="44" rx="12" fill="#2a2a2a"/>
        <rect x="80" y="56" width="40" height="16" rx="5" fill="#fff" opacity=".9"/>
        <rect x="52" y="70" width="96" height="138" rx="22" fill="${c}"/>
        <rect x="52" y="70" width="96" height="138" rx="22" fill="url(#g)"/>`,
      skin: `<rect x="58" y="22" width="84" height="26" rx="8" fill="#fff" opacity=".9"/>
        <path d="M60 46h80l14 150a12 12 0 0 1-12 13H58a12 12 0 0 1-12-13z" fill="${c}"/>
        <path d="M60 46h80l14 150a12 12 0 0 1-12 13H58a12 12 0 0 1-12-13z" fill="url(#g)"/>`,
      weight: `<rect x="28" y="52" width="144" height="26" rx="10" fill="#fff" opacity=".9"/>
        <rect x="24" y="74" width="152" height="134" rx="20" fill="${c}"/>
        <rect x="24" y="74" width="152" height="134" rx="20" fill="url(#g)"/>`,
      wellness: `<path d="M44 52 70 30h60l26 22v150a8 8 0 0 1-8 8H52a8 8 0 0 1-8-8z" fill="${c}"/>
        <path d="M44 52 70 30h60l26 22v150a8 8 0 0 1-8 8H52a8 8 0 0 1-8-8z" fill="url(#g)"/>`,
    };
    const body = shapes[product.category] || shapes.vitamins;
    return `<svg viewBox="0 0 200 230" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".08"/></linearGradient></defs>
      <ellipse cx="100" cy="214" rx="78" ry="9" fill="#000" opacity=".08"/>
      ${body}
      <text x="100" y="150" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="13" font-weight="600" fill="#1d1d1d" opacity=".8">${name}</text>
      <text x="100" y="128" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="22" font-weight="700" fill="#1d1d1d" opacity=".75">v</text>
    </svg>`;
  }
  // Soft background behind the product art
  const tint = (hex) => `background:${hex || "#d9e4b8"}55`;

  function toast(msg) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#111;color:#fff;padding:12px 20px;border-radius:99px;font-size:13px;z-index:50;transition:opacity .3s";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = "1";
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.style.opacity = "0"), 2200);
  }

  async function api(path, opts) {
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong");
    return data;
  }

  async function init() {
    renderBagCount();
    try { await syncGuest(); } catch {}
    try { currency = (await api("/api/shop/config")).currency || currency; } catch {}
  }

  return { esc, money, readCart, writeCart, addToCart, art, tint, toast, api, init, syncGuest, guest: () => guestState, checkoutKey };
})();
