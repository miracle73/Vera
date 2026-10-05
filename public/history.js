(async () => {
  const el = document.getElementById('history');
  const purchases = document.body.dataset.history === 'purchases';
  const date = value => new Date(value).toLocaleDateString('en-GB', { day:'numeric',month:'short',year:'numeric' });
  try {
    await Vera.init();
    const { orders } = await Vera.api('/api/guest/history');
    const rows = orders.filter(o => purchases ? o.status === 'paid' : o.payment_started || o.payment_ref);
    if (!rows.length) { el.innerHTML = '<p class="empty">' + (purchases ? 'No purchases yet.' : 'No payment transactions yet.') + ' <a href="/">Shop with Vera</a></p>'; return; }
    el.innerHTML = rows.map(o => '<article class="panel history-card"><div class="history-head"><h2>Order ' + Vera.esc(o.id.slice(0,8).toUpperCase()) + '</h2><span class="history-status">' + Vera.esc(o.status) + '</span></div><p>' + date(o.created_at) + ' · <strong>' + Vera.money(o.total) + '</strong></p>' + (purchases ? '<ul>' + o.items.map(i => '<li>' + i.quantity + ' × ' + Vera.esc(i.name) + ' — ' + Vera.money(i.price*i.quantity) + '</li>').join('') + '</ul>' : '<dl><dt>Provider</dt><dd>' + Vera.esc(o.payment_provider || '—') + '</dd><dt>Reference</dt><dd>' + Vera.esc(o.payment_ref || 'Payment initialization pending') + '</dd><dt>Updated</dt><dd>' + date(o.updated_at) + '</dd></dl>') + '</article>').join('');
  } catch (err) { el.innerHTML = '<p class="error">' + Vera.esc(err.message) + '</p><button class="btn" onclick="location.reload()">Retry</button>'; }
})();