/* Painel /admin — consome /api/admin/* e desenha tudo sem dependências externas. */
(function () {
  'use strict';

  var ORANGE = '#7c5cff', ORANGE2 = '#22d3ee', BAR = 'rgba(255,255,255,0.09)', MUTED = '#6f6f97';
  var state = { days: 7, metric: 'revenue', data: null, orders: [], orderStatus: '', orderQuery: '', timer: null, seenPaid: null, audio: null };

  var $ = function (id) { return document.getElementById(id); };
  var svgIcon = function (id) { return '<svg class="ic"><use href="#ic-' + id + '"></use></svg>'; };
  var el = function (tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  var brl = function (c) { return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var todayBRT = function () { return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); };

  // ---------- auth ----------
  function token() { return sessionStorage.getItem('admin_token') || ''; }
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'x-admin-key': token() }, opts.headers || {});
    return fetch('/api/admin/' + path, opts).then(function (r) {
      if (r.status === 401) { logout(); throw new Error('unauthorized'); }
      return r;
    });
  }
  function logout() {
    sessionStorage.removeItem('admin_token');
    if (state.timer) clearInterval(state.timer);
    $('app').classList.remove('on');
    $('login').style.display = 'flex';
  }
  function doLogin() {
    var pass = $('senha').value;
    if (!pass) return;
    initAudio();
    $('login-erro').textContent = 'Entrando…';
    fetch('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pass }),
    }).then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); }).then(function (res) {
      if (res.s === 200 && res.j.token) {
        sessionStorage.setItem('admin_token', res.j.token);
        boot();
      } else if (res.s === 429) {
        $('login-erro').textContent = 'Muitas tentativas. Aguarde alguns minutos.';
      } else {
        $('login-erro').textContent = 'Senha incorreta.';
      }
    }).catch(function () { $('login-erro').textContent = 'Erro de conexão.'; });
  }
  $('entrar').addEventListener('click', doLogin);
  $('senha').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  $('btn-sair').addEventListener('click', logout);

  // ---------- alerta sonoro de venda ----------
  function initAudio() { try { if (!state.audio) state.audio = new (window.AudioContext || window.webkitAudioContext)(); if (state.audio.state === 'suspended') state.audio.resume(); } catch (e) { /* sem áudio */ } }
  function beep() {
    if (!state.audio) return;
    [880, 1320].forEach(function (freq, i) {
      var o = state.audio.createOscillator(), g = state.audio.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      var t = state.audio.currentTime + i * 0.14;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o.connect(g); g.connect(state.audio.destination); o.start(t); o.stop(t + 0.14);
    });
  }

  // ---------- deltas ----------
  function delta(curr, prev, moneyMode) {
    if (!prev) return '<span class="delta flat">novo</span>';
    var pct = Math.round(((curr - prev) / prev) * 100);
    var cls = pct === 0 ? 'flat' : (pct > 0 ? 'up' : 'down');
    var arrow = pct === 0 ? '•' : (pct > 0 ? '▲' : '▼');
    return '<span class="delta ' + cls + '">' + arrow + ' ' + Math.abs(pct) + '%</span>';
  }

  // ---------- hero + mini ----------
  function renderHero(d) {
    var k = d.kpis, p = d.prevKpis;
    if ($('globe-visits')) { $('globe-visits').textContent = String(k.visits); $('globe-uniques').textContent = String(k.uniques); }
    $('hero').innerHTML =
      heroCard(true, 'money', 'Faturamento', 'bruto no período', brl(k.gross), delta(k.gross, p.gross), 'ticket médio ' + brl(k.ticket)) +
      heroCard(false, 'bank', 'Líquido', 'após taxas do gateway', brl(k.net), delta(k.net, p.net), 'margem ' + (k.gross ? Math.round(k.net / k.gross * 100) : 0) + '%') +
      heroCard(false, 'cart', 'Vendas pagas', 'pedidos confirmados', String(k.paidCount), delta(k.paidCount, p.paidCount), 'conversão PIX ' + k.pixConversion + '%');

    var mini = [
      { l: 'Lucro (pós-gasto)', v: brl(k.profit), d: delta(k.profit, p.profit) },
      { l: 'ROAS', v: k.roas ? k.roas + 'x' : '—', d: k.spend ? delta(k.roas, p.roas) : '' },
      { l: 'Ticket médio', v: brl(k.ticket), d: delta(k.ticket, p.ticket) },
      { l: 'Conversão PIX', v: k.pixConversion + '%', d: delta(k.pixConversion, p.pixConversion) },
      { l: 'Visitas', v: String(k.visits), d: delta(k.visits, p.visits) },
      { l: 'Tempo até pagar', v: d.avgPayMinutes ? d.avgPayMinutes + ' min' : '—', d: '' },
    ];
    $('mini').innerHTML = mini.map(function (m) {
      return '<div class="mini"><div class="l">' + m.l + '</div><div class="v">' + m.v + '</div>' + (m.d ? '<div class="d">' + m.d + '</div>' : '') + '</div>';
    }).join('');
  }
  function heroCard(accent, ic, title, sub, val, dl, foot) {
    return '<div class="hero' + (accent ? ' accent' : '') + '">' +
      '<div class="h-top"><div class="h-ic">' + svgIcon(ic) + '</div><div><div class="h-title">' + title + '</div><div class="h-sub">' + sub + '</div></div></div>' +
      '<div class="h-val">' + val + '</div>' +
      '<div class="h-foot"><span>' + foot + '</span>' + dl + '</div></div>';
  }

  // ---------- meta ----------
  function donut(pct) {
    var r = 34, c = 2 * Math.PI * r, off = c * (1 - Math.min(100, Math.max(0, pct)) / 100);
    return '<svg class="gauge" viewBox="0 0 92 92">' +
      '<defs><linearGradient id="gg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>' +
      '<circle cx="46" cy="46" r="' + r + '" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="8"/>' +
      '<circle cx="46" cy="46" r="' + r + '" fill="none" stroke="url(#gg)" stroke-width="8" stroke-linecap="round" stroke-dasharray="' + c + '" stroke-dashoffset="' + off + '" transform="rotate(-90 46 46)"/>' +
      '<text x="46" y="47" text-anchor="middle" dominant-baseline="middle">' + pct + '%</text></svg>';
  }
  function renderGoal(d) {
    var g = d.goal;
    if (!g.amount) {
      $('goal-body').innerHTML = '<div class="goal-sub">Nenhuma meta definida.</div>' +
        '<button class="btn-o" id="goal-set" style="margin-top:6px">Definir meta do mês</button>';
      $('goal-set').addEventListener('click', openGoalModal);
      return;
    }
    var pct = Math.min(100, Math.round(g.monthRevenue / g.amount * 100));
    var onTrack = g.projection >= g.amount;
    $('goal-body').innerHTML =
      '<div class="goal-head">' + donut(pct) +
      '<div><div class="goal-val">' + brl(g.monthRevenue) + '</div>' +
      '<div class="goal-sub">de ' + brl(g.amount) + ' · meta do mês</div></div></div>' +
      '<div class="track"><i style="width:' + pct + '%"></i></div>' +
      '<div class="goal-legend"><span>dia ' + g.elapsed + '/' + g.daysInMonth + '</span>' +
      '<span class="' + (onTrack ? 'roas-tag good' : 'roas-tag bad') + '">projeção ' + brl(g.projection) + '</span></div>' +
      '<div class="prod-mini" id="goal-prods"></div>';
    var top = (d.products || []).slice(0, 4);
    $('goal-prods').innerHTML = top.map(function (p) {
      return '<div class="prod-cell"><div class="pn">' + esc(p.label) + '</div><div class="pv">' + brl(p.revenue) + '</div><div class="pc">' + p.paid + ' venda(s)</div></div>';
    }).join('') || '<div class="sub">Sem vendas ainda.</div>';
  }

  // ---------- gráfico ----------
  var METRIC = { revenue: { label: 'receita no período', money: true }, pago: { label: 'vendas no período', money: false }, pix: { label: 'PIX gerados no período', money: false }, visits: { label: 'visitas no período', money: false } };
  function renderChart(d) {
    var rows = d.daily, m = state.metric, money = METRIC[m].money;
    var vals = rows.map(function (r) { return r[m] || 0; });
    var total = vals.reduce(function (a, b) { return a + b; }, 0);
    var max = Math.max.apply(null, vals.concat([1]));
    var peak = vals.indexOf(Math.max.apply(null, vals));

    $('chart-big').textContent = money ? brl(total) : total.toLocaleString('pt-BR');
    $('chart-cap').textContent = METRIC[m].label;

    var W = Math.max(560, rows.length * 40), H = 210, padL = 8, padB = 24, padT = 12;
    var plotW = W - padL, plotH = H - padT - padB, bw = Math.min(26, (plotW / rows.length) - 6);
    var fmtY = function (v) { return money ? (v >= 100000 ? 'R$' + Math.round(v / 100000) / 10 + 'k' : 'R$' + Math.round(v / 100)) : String(Math.round(v)); };

    var svg = '<svg width="' + W + '" height="' + H + '" role="img" aria-label="' + METRIC[m].label + '">';
    svg += '<defs><linearGradient id="og" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + ORANGE + '"/><stop offset="1" stop-color="' + ORANGE2 + '"/></linearGradient>' +
      '<filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>';
    rows.forEach(function (r, i) {
      var v = r[m] || 0, h = Math.round(plotH * v / max);
      var x = padL + (plotW / rows.length) * i + ((plotW / rows.length) - bw) / 2, y = padT + plotH - h;
      var isPeak = i === peak && v > 0;
      svg += '<rect class="cbar" data-i="' + i + '" x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(h, 2) + '" rx="5" fill="' + (isPeak ? 'url(#og)' : BAR) + '"' + (isPeak ? ' filter="url(#glow)"' : '') + '/>';
      if (rows.length <= 14 || i % Math.ceil(rows.length / 14) === 0) {
        svg += '<text x="' + (x + bw / 2) + '" y="' + (H - 7) + '" text-anchor="middle" font-size="10" fill="' + MUTED + '">' + r.day.slice(8) + '/' + r.day.slice(5, 7) + '</text>';
      }
    });
    svg += '</svg>';
    $('chart').innerHTML = svg;

    var tip = $('tip'), wrap = $('chart').parentNode;
    $('chart').querySelectorAll('.cbar').forEach(function (rect) {
      rect.addEventListener('mouseenter', function () {
        var i = +rect.getAttribute('data-i'), r = rows[i];
        rect.setAttribute('fill', 'url(#og)');
        var val = money ? brl(r[m] || 0) : (r[m] || 0);
        tip.innerHTML = '<b>' + r.day.slice(8) + '/' + r.day.slice(5, 7) + '</b>' + val + (m === 'revenue' ? ' · ' + r.pago + ' venda(s)' : '');
        var bx = +rect.getAttribute('x'), by = +rect.getAttribute('y');
        tip.style.opacity = '1';
        tip.style.left = Math.min(wrap.clientWidth - 120, Math.max(4, bx - 30)) + 'px';
        tip.style.top = Math.max(0, by - 46) + 'px';
      });
      rect.addEventListener('mouseleave', function () {
        var i = +rect.getAttribute('data-i');
        rect.setAttribute('fill', i === peak && (rows[i][m] || 0) > 0 ? 'url(#og)' : BAR);
        tip.style.opacity = '0';
      });
    });
  }

  // ---------- funil ----------
  function renderFunnel(d) {
    var max = Math.max.apply(null, d.funnel.map(function (f) { return f.count; }).concat([1]));
    $('funnel').innerHTML = d.funnel.map(function (f, i) {
      var w = Math.round(f.count / max * 100);
      return '<div class="fn-row"><div class="fn-label">' + esc(f.step) + '</div>' +
        '<div class="fn-track"><div class="fn-bar" style="width:' + w + '%"></div></div>' +
        '<div class="fn-num">' + f.count + (i > 0 ? ' <span class="pct">(' + f.rate + '%)</span>' : '') + '</div></div>';
    }).join('');
  }

  // ---------- tabelas ----------
  function tableHTML(headers, rows, empty) {
    if (!rows.length) return '<div class="empty">' + empty + '</div>';
    return '<table class="data"><thead><tr>' + headers.map(function (h) { return '<th class="' + (h.num ? 'num' : '') + '">' + h.t + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return '<td class="' + (headers[i].num ? 'num' : '') + '">' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
  }
  function renderUtm(d) {
    $('utm').innerHTML = tableHTML(
      [{ t: 'Origem' }, { t: 'Visitas', num: 1 }, { t: 'Vendas', num: 1 }, { t: 'Receita', num: 1 }, { t: 'Gasto', num: 1 }, { t: 'ROAS', num: 1 }],
      d.utm.map(function (u) {
        var roas = u.spend ? '<span class="roas-tag ' + (u.revenue >= u.spend ? 'good' : 'bad') + '">' + u.roas + 'x</span>' : '<span class="sub">—</span>';
        return [esc(u.source) + (u.campaign ? '<div class="sub">' + esc(u.campaign) + '</div>' : ''), u.views, u.pago, brl(u.revenue), u.spend ? brl(u.spend) : '<span class="sub">—</span>', roas];
      }),
      'Sem tráfego registrado ainda.'
    );
  }
  function renderProducts(d) {
    $('products').innerHTML = tableHTML(
      [{ t: 'Produto' }, { t: 'Vendas', num: 1 }, { t: 'Receita', num: 1 }],
      d.products.map(function (p) { return [esc(p.label), p.paid, brl(p.revenue)]; }),
      'Nenhuma venda no período.'
    );
  }

  // ---------- heatmap ----------
  var WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  function renderHeat(d) {
    var heat = d.heatmap, max = 1;
    heat.forEach(function (row) { row.forEach(function (c) { if (c > max) max = c; }); });
    var html = '<table><thead><tr><th></th>';
    for (var h = 0; h < 24; h++) html += '<th>' + (h % 3 === 0 ? h : '') + '</th>';
    html += '</tr></thead><tbody>';
    heat.forEach(function (row, wd) {
      html += '<tr><td class="rowlabel">' + WD[wd] + '</td>';
      row.forEach(function (c) {
        var a = c ? (0.18 + 0.82 * c / max) : 0;
        var bg = c ? 'rgba(255,106,43,' + a.toFixed(2) + ')' : BAR;
        html += '<td><div class="cell" style="background:' + bg + '" title="' + WD[wd] + ' ' + '"></div></td>';
      });
      html += '</tr>';
    });
    $('heat').innerHTML = html + '</tbody></table>';
  }

  // ---------- pedidos / abandonados ----------
  var fmtDH = function (ts) { return ts ? new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'; };
  var piiOn = function () { return !(state.flags && state.flags.mascarar_pii === false); };
  var maskEmail = function (e) { e = String(e || ''); if (!piiOn()) return e; var at = e.indexOf('@'); return at < 2 ? e : e.slice(0, 2) + '***' + e.slice(at); };
  var maskPhone = function (p) { p = String(p || '').replace(/\D/g, ''); if (!piiOn()) return p; return p.length < 6 ? p : p.slice(0, 2) + '*****' + p.slice(-2); };

  function renderOrders() {
    var rows = state.orders.filter(function (o) {
      if (state.orderStatus && o.status !== state.orderStatus) return false;
      if (state.orderQuery) {
        var q = state.orderQuery.toLowerCase();
        if (!((o.nome || '').toLowerCase().indexOf(q) >= 0 || (o.email || '').toLowerCase().indexOf(q) >= 0 || (o.id || '').toLowerCase().indexOf(q) >= 0)) return false;
      }
      return true;
    }).slice(0, 60);
    $('orders').innerHTML = tableHTML(
      [{ t: 'Quando' }, { t: 'Cliente' }, { t: 'Produto' }, { t: 'Origem' }, { t: 'Valor', num: 1 }, { t: 'Status' }],
      rows.map(function (o) {
        var pill = o.status === 'paid' ? '<span class="pill paid"><span class="pd"></span>PAGO</span>' : '<span class="pill pending"><span class="pd"></span>PENDENTE</span>';
        return [fmtDH(o.createdAt), esc(o.nome) + '<div class="sub">' + esc(maskEmail(o.email)) + '</div>', esc(o.label), esc(o.utmSource || '—'), o.price, pill];
      }),
      'Nenhum pedido no período.'
    );
  }
  function renderAbandoned(list) {
    $('abandoned').innerHTML = tableHTML(
      [{ t: 'Quando' }, { t: 'Cliente' }, { t: 'Produto' }, { t: 'Valor', num: 1 }, { t: 'Recuperar' }],
      list.slice(0, 60).map(function (o) {
        var phone = String(o.telefone || '').replace(/\D/g, '');
        var msg = 'Oi ' + (o.nome || '').split(' ')[0] + '! Vi que você gerou o PIX do ' + o.label + ' mas não finalizou. Posso te ajudar a concluir?';
        var wa = phone ? '<a class="wa" target="_blank" rel="noopener" href="https://wa.me/55' + phone + '?text=' + encodeURIComponent(msg) + '">💬 WhatsApp</a>' : '<span class="sub">sem telefone</span>';
        return [fmtDH(o.createdAt), esc(o.nome) + '<div class="sub">' + esc(maskPhone(o.telefone)) + '</div>', esc(o.label), o.price, wa];
      }),
      'Nenhum PIX abandonado. 🎉'
    );
  }

  // ---------- banner ----------
  function renderBanner(d) {
    var msgs = [];
    if (d.storage === 'memory') msgs.push('⚠️ Armazenamento temporário — métricas podem zerar. (' + (d.storageDetail || 'Blobs indisponível') + ')');
    if (d.provider === 'stub') msgs.push('⚠️ Gateway em modo simulado (chaves da AssetPay não configuradas).');
    if (!d.telegram) msgs.push('💡 Notificações no Telegram desativadas — configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID.');
    $('foot-provider').textContent = d.provider === 'assetpay' ? 'AssetPay conectada' : 'Modo simulado';
    $('foot-storage').textContent = d.storage === 'blobs' ? 'dados persistentes' : 'armazenamento temporário';
    var b = $('banner'); b.innerHTML = msgs.join('<br>'); b.style.display = msgs.length ? 'block' : 'none';
  }

  // ---------- modais ----------
  function modal(title, bodyHTML, onOk) {
    var ov = el('div', 'modal-ov');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:100;padding:20px';
    ov.innerHTML = '<div style="background:#1a1a1a;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:20px;width:100%;max-width:360px">' +
      '<h2 style="font-size:16px;margin-bottom:14px">' + title + '</h2>' + bodyHTML +
      '<div style="display:flex;gap:8px;margin-top:16px"><button class="btn-ghost" data-x style="flex:1">Cancelar</button><button class="btn-o" data-ok style="flex:1">Salvar</button></div></div>';
    document.body.appendChild(ov);
    ov.querySelector('[data-x]').addEventListener('click', function () { ov.remove(); });
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
    ov.querySelector('[data-ok]').addEventListener('click', function () { onOk(ov, function () { ov.remove(); }); });
    return ov;
  }
  var IN = 'width:100%;padding:11px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:#0d0d0d;color:#fff;font-size:14px;margin-bottom:10px;outline:none';
  function openGoalModal() {
    var cur = state.data && state.data.goal.amount ? (state.data.goal.amount / 100) : '';
    modal('Meta do mês', '<label class="sub">Valor da meta (R$)</label><input id="m-goal" type="number" step="1" value="' + cur + '" style="' + IN + '" placeholder="30000">', function (ov, close) {
      var v = parseFloat(ov.querySelector('#m-goal').value) || 0;
      api('goal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: v }) }).then(function () { close(); load(); });
    });
  }
  function openSpendModal() {
    modal('Lançar gasto de tráfego', '<label class="sub">Data</label><input id="m-day" type="date" value="' + todayBRT() + '" style="' + IN + '">' +
      '<label class="sub">Origem (igual ao utm_source do anúncio)</label><input id="m-src" placeholder="instagram" style="' + IN + '">' +
      '<label class="sub">Valor gasto no dia (R$)</label><input id="m-amt" type="number" step="0.01" placeholder="150" style="' + IN + '">',
      function (ov, close) {
        var body = { day: ov.querySelector('#m-day').value, source: ov.querySelector('#m-src').value || '(geral)', amount: parseFloat(ov.querySelector('#m-amt').value) || 0 };
        api('spend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function () { close(); load(); });
      });
  }
  $('goal-edit').addEventListener('click', openGoalModal);

  // ---------- carregar ----------
  function load() {
    api('summary?days=' + state.days).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) return;
      state.data = d;
      renderBanner(d); renderHero(d); renderGoal(d); renderChart(d); renderFunnel(d); renderUtm(d); renderProducts(d); renderHeat(d);
      $('foot-updated').textContent = 'Atualizado às ' + new Date(d.generatedAt).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' · atualiza sozinho a cada 60s';
    }).catch(function () {});

    api('orders?days=' + state.days).then(function (r) { return r.json(); }).then(function (j) {
      state.orders = j.orders || [];
      $('nav-orders').textContent = state.orders.length;
      renderOrders();
      // alerta de venda nova
      var paidIds = state.orders.filter(function (o) { return o.status === 'paid'; }).map(function (o) { return o.id; });
      if (state.seenPaid === null) { state.seenPaid = {}; paidIds.forEach(function (id) { state.seenPaid[id] = 1; }); }
      else { var novos = paidIds.filter(function (id) { return !state.seenPaid[id]; }); if (novos.length) { if (!(state.flags && state.flags.som_venda === false)) beep(); novos.forEach(function (id) { state.seenPaid[id] = 1; }); } }
    }).catch(function () {});

    api('abandoned?days=' + state.days).then(function (r) { return r.json(); }).then(function (j) {
      $('nav-aband').textContent = (j.abandoned || []).length;
      renderAbandoned(j.abandoned || []);
    }).catch(function () {});
  }

  // ---------- controles ----------
  $('period').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    $('period').querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
    b.classList.add('on'); state.days = +b.dataset.days; load();
  });
  $('metric').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    $('metric').querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
    b.classList.add('on'); state.metric = b.dataset.metric; if (state.data) renderChart(state.data);
  });
  $('order-filter').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    $('order-filter').querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
    b.classList.add('on'); state.orderStatus = b.dataset.status; renderOrders();
  });
  $('order-search').addEventListener('input', function (e) { state.orderQuery = e.target.value; renderOrders(); });
  $('side-search').addEventListener('input', function (e) { state.orderQuery = e.target.value; $('order-search').value = e.target.value; renderOrders(); showView('vendas'); });
  $('btn-refresh').addEventListener('click', load);
  $('btn-csv').addEventListener('click', function () {
    api('export.csv?days=' + state.days).then(function (r) { return r.blob(); }).then(function (blob) {
      var a = el('a'); a.href = URL.createObjectURL(blob); a.download = 'pedidos.csv'; a.click(); URL.revokeObjectURL(a.href);
    });
  });
  // ---------- navegação por abas (views) ----------
  var VIEWS = {
    overview: { t: 'Visão geral', s: 'Os números que importam agora', data: true },
    vendas: { t: 'Vendas', s: 'Pedidos e clientes', data: true },
    abandonados: { t: 'PIX abandonados', s: 'Recupere quem gerou e não pagou', data: true },
    publicacoes: { t: 'Publicações', s: 'Publique um vídeo em várias redes de uma vez', data: false },
    funil: { t: 'Funil de conversão', s: 'Onde as pessoas param', data: true },
    trafego: { t: 'Tráfego e ROAS', s: 'Retorno por origem de tráfego', data: true },
    metas: { t: 'Metas & produtos', s: 'Progresso do mês', data: true },
    pagina: { t: 'Página', s: 'Edite a página de vendas (textos e imagens)', data: false },
    config: { t: 'Configurações', s: 'Preços, links e textos — valem na hora', data: false },
    recursos: { t: 'Recursos', s: 'Ligue e desligue funcionalidades', data: false },
  };
  function csvVisible() { return (state.view === 'vendas' || state.view === 'overview') && !(state.flags && state.flags.export_csv === false); }
  function setCsv() { var b = $('btn-csv'); if (b) b.style.display = csvVisible() ? '' : 'none'; }
  function showView(name) {
    if (!VIEWS[name]) name = 'overview';
    state.view = name;
    document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('on', v.dataset.view === name); });
    document.querySelectorAll('.nav-item[data-view]').forEach(function (n) { n.classList.toggle('active', n.dataset.view === name); });
    $('view-title').textContent = VIEWS[name].t;
    $('head-sub').textContent = VIEWS[name].s;
    $('period').style.display = VIEWS[name].data ? '' : 'none';
    setCsv();
    if (name === 'overview' && state.data) renderChart(state.data); // re-mede o container ao exibir
    if (name === 'overview' && window.__globeResize) window.__globeResize();
    if (name === 'publicacoes') loadSocialHistory();
    if (name === 'pagina') renderPagina();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.nav-item[data-view]').forEach(function (item) {
    item.addEventListener('click', function () { showView(item.dataset.view); });
  });
  $('btn-spend').addEventListener('click', openSpendModal);

  // ---------- recursos (on/off) ----------
  function applyFlags() {
    var f = state.flags || {};
    var show = function (id, on) { var e = $(id); if (e) e.style.display = (on === false) ? 'none' : ''; };
    show('sec-goal', f.card_meta); show('sec-traffic', f.card_roas); show('card-produtos', f.card_produtos);
    show('sec-funnel', f.card_funil); show('sec-heat', f.card_heatmap); show('sec-abandoned', f.card_abandonados);
    var navPub = document.querySelector('.nav-item[data-view="publicacoes"]');
    if (navPub) navPub.style.display = (f.social_publisher === false) ? 'none' : '';
    var navPg = document.querySelector('.nav-item[data-view="pagina"]');
    if (navPg) navPg.style.display = (f.page_editor === false) ? 'none' : '';
    setCsv();
  }
  function renderFeatures() {
    var q = (state.featQuery || '').toLowerCase(), byCat = {}, ativos = 0, total = 0;
    (state.features || []).forEach(function (f) {
      if (f.status === 'ativo') total++;
      if (f.status === 'ativo' && state.flags[f.id]) ativos++;
      if (q && (f.label + ' ' + f.desc).toLowerCase().indexOf(q) < 0) return;
      (byCat[f.cat] = byCat[f.cat] || []).push(f);
    });
    var html = '';
    Object.keys(byCat).forEach(function (cat) {
      html += '<div class="feat-cat">' + esc(cat) + '</div>';
      byCat[cat].forEach(function (f) {
        var on = !!state.flags[f.id], soon = f.status !== 'ativo';
        var badge = soon ? '<span class="badge-soon">em breve</span>' : (on ? '<span class="badge-on">ativo</span>' : '');
        html += '<div class="feat-row"><div class="fx"><div class="fl">' + esc(f.label) + badge + '</div><div class="fd">' + esc(f.desc) + '</div></div>' +
          '<div class="sw' + (on ? ' on' : '') + (soon ? ' dis' : '') + '" data-fid="' + f.id + '" data-soon="' + (soon ? 1 : 0) + '"></div></div>';
      });
    });
    $('features-list').innerHTML = html;
    $('feat-count').textContent = ativos + ' de ' + total + ' recursos ativos · ' + (state.features || []).length + ' no total';
  }

  // ---------- configurações editáveis ----------
  var PRICE_LABELS = {
    'checkout/mensal': 'Checkout — Mensal', 'checkout/trimestral': 'Checkout — Trimestral', 'checkout/anual': 'Checkout — Anual',
    'upsell/mensal': 'Upsell — Mensal', 'upsell/trimestral': 'Upsell — Trimestral',
    'downsell/mensal': 'Downsell — Mensal', 'downsell/trimestral': 'Downsell — Trimestral',
  };
  function renderSettings() {
    var s = state.settings; if (!s) return;
    $('set-prices').innerHTML = Object.keys(PRICE_LABELS).map(function (k) {
      var reais = ((s.prices[k] || 0) / 100).toFixed(2);
      return '<div class="feat-row"><div class="fx"><div class="fl">' + PRICE_LABELS[k] + '</div></div>' +
        '<input class="set-in price-in" data-key="' + k + '" type="number" step="0.01" value="' + reais + '"></div>';
    }).join('');
    $('set-vip').value = s.vipLink || ''; $('set-support').value = s.supportLink || '';
    $('set-recovery').value = s.recoveryMsg || ''; $('set-abandon').value = s.abandonMinutes || 10;
  }
  function saveSettings() {
    var prices = {};
    document.querySelectorAll('.price-in').forEach(function (inp) { prices[inp.dataset.key] = Math.round(parseFloat(inp.value || '0') * 100); });
    var patch = {
      prices: prices,
      vipLink: $('set-vip').value, supportLink: $('set-support').value,
      recoveryMsg: $('set-recovery').value, abandonMinutes: parseInt($('set-abandon').value, 10) || 10,
    };
    $('set-status').textContent = 'salvando…';
    api('settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      .then(function (r) { return r.json(); }).then(function (j) {
        if (j.ok) { state.settings = j.settings; renderSettings(); $('set-status').textContent = '✅ salvo'; setTimeout(function () { $('set-status').textContent = ''; }, 2500); }
      }).catch(function () { $('set-status').textContent = 'erro ao salvar'; });
  }

  function loadConfig() {
    api('features').then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) return; state.features = j.features; state.flags = j.flags; renderFeatures(); applyFlags();
    }).catch(function () {});
    api('settings').then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) return; state.settings = j.settings; renderSettings();
    }).catch(function () {});
  }

  $('features-list').addEventListener('click', function (e) {
    var sw = e.target.closest('.sw'); if (!sw || sw.dataset.soon === '1') return;
    var id = sw.dataset.fid, on = !state.flags[id];
    state.flags[id] = on; sw.classList.toggle('on', on);
    api('features', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, on: on }) })
      .then(function () { renderFeatures(); applyFlags(); });
  });
  $('feat-search').addEventListener('input', function (e) { state.featQuery = e.target.value; renderFeatures(); });
  $('set-save').addEventListener('click', saveSettings);

  // ---------- publicações (multi-rede) ----------
  function setSoc(msg) { $('soc-status').textContent = msg || ''; }
  function publishSocial() {
    var file = $('soc-file').files[0];
    var caption = $('soc-caption').value.trim();
    var nets = [].slice.call(document.querySelectorAll('#soc-nets input:checked')).map(function (c) { return c.value; });
    var autoNets = nets.filter(function (n) { return n !== 'kwai'; });
    if (!nets.length) { setSoc('Marque pelo menos uma rede.'); return; }
    if (autoNets.length && !file) { setSoc('Selecione o vídeo.'); return; }
    var fd = new FormData();
    if (file) fd.append('video', file);
    fd.append('caption', caption);
    nets.forEach(function (n) { fd.append('networks', n); });
    $('soc-publish').disabled = true; setSoc('Publicando…');
    fetch('/api/admin/social/post', { method: 'POST', headers: { 'x-admin-key': token() }, body: fd })
      .then(function (r) { if (r.status === 401) { logout(); throw new Error('unauth'); } return r.json(); })
      .then(function (j) {
        $('soc-publish').disabled = false;
        if (!j.ok) { setSoc('Erro: ' + (j.error || 'falhou')); return; }
        var prov = j.post && j.post.provider;
        setSoc(prov === 'stub' ? '✅ Registrado (modo simulado — conecte a agregadora pra publicar de verdade)' : '✅ Publicado!');
        if (nets.indexOf('kwai') >= 0) showKwai(file, caption); else $('soc-kwai').style.display = 'none';
        loadSocialHistory();
      })
      .catch(function () { $('soc-publish').disabled = false; setSoc('Erro de conexão.'); });
  }
  function showKwai(file, caption) {
    var box = $('soc-kwai'); box.style.display = 'block';
    box.innerHTML = '<div class="cap" style="margin-bottom:8px">🟠 <b>Kwai é manual</b> — poste você mesmo com a legenda abaixo:</div>' +
      '<div class="pix-code" style="white-space:pre-wrap">' + esc(caption || '(sem legenda)') + '</div>' +
      '<div style="margin-top:8px">' + (file ? '<a class="btn-ghost" id="soc-kwai-dl">⬇ Baixar vídeo</a> ' : '') +
      '<button class="btn-ghost" id="soc-kwai-copy">Copiar legenda</button> <button class="btn-o" id="soc-kwai-done">Já postei no Kwai</button></div>';
    if (file) { var a = $('soc-kwai-dl'); a.href = URL.createObjectURL(file); a.download = file.name || 'video.mp4'; }
    $('soc-kwai-copy').addEventListener('click', function () { try { navigator.clipboard.writeText(caption || ''); setSoc('Legenda copiada.'); } catch (e) { /* */ } });
    $('soc-kwai-done').addEventListener('click', function () { box.style.display = 'none'; });
  }
  function loadSocialHistory() {
    api('social/posts?days=30').then(function (r) { return r.json(); }).then(function (j) {
      var posts = j.posts || [];
      $('soc-history').innerHTML = tableHTML(
        [{ t: 'Quando' }, { t: 'Legenda' }, { t: 'Redes' }, { t: 'Kwai' }],
        posts.map(function (p) {
          var nets = (p.results || []).map(function (r) { return '<span class="pill ' + (r.status === 'published' ? 'paid' : 'pending') + '"><span class="pd"></span>' + esc(r.network) + '</span>'; }).join(' ') || '<span class="sub">—</span>';
          var kwai = p.kwai === 'pending' ? '<span class="pill pending">pendente</span>' : (p.kwai === 'done' ? '<span class="pill paid">feito</span>' : '<span class="sub">—</span>');
          return [fmtDH(p.createdAt), '<span class="sub">' + esc((p.caption || '').slice(0, 40)) + '</span>', nets, kwai];
        }),
        'Nenhuma publicação ainda.'
      );
    }).catch(function () {});
  }
  $('soc-publish').addEventListener('click', publishSocial);

  // ---------- editor da página (landing) ----------
  function renderPagina() {
    var s = state.settings; if (!s) return;
    $('pg-name').value = s.siteName || '';
    $('pg-user').value = s.siteUser || '';
    $('pg-biotitle').value = s.siteBioTitle || '';
    $('pg-biotext').value = s.siteBioText || '';
    $('pg-stats').value = s.siteStats || '';
    var av = $('pg-avatar-preview'); av.style.display = s.avatarVer ? '' : 'none'; if (s.avatarVer) av.src = '/img/avatar?v=' + s.avatarVer;
    var cp = $('pg-capa-preview'); cp.style.display = s.capaVer ? '' : 'none'; if (s.capaVer) cp.src = '/img/capa?v=' + s.capaVer;
  }
  function uploadImg(name, file) {
    var fd = new FormData(); fd.append('file', file);
    return fetch('/api/admin/media/' + name, { method: 'POST', headers: { 'x-admin-key': token() }, body: fd }).then(function (r) { return r.json(); });
  }
  function savePagina() {
    var patch = {
      siteName: $('pg-name').value, siteUser: $('pg-user').value,
      siteBioTitle: $('pg-biotitle').value, siteBioText: $('pg-biotext').value, siteStats: $('pg-stats').value,
    };
    var avatarFile = $('pg-avatar').files[0], capaFile = $('pg-capa').files[0];
    $('pg-save').disabled = true; $('pg-status').textContent = 'salvando…';
    var jobs = [api('settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).then(function (r) { return r.json(); })];
    if (avatarFile) jobs.push(uploadImg('avatar', avatarFile));
    if (capaFile) jobs.push(uploadImg('capa', capaFile));
    Promise.all(jobs).then(function (res) {
      var bad = res.filter(function (x) { return !x || !x.ok; });
      $('pg-save').disabled = false;
      if (bad.length) { $('pg-status').textContent = 'erro ao salvar (' + (bad[0] && bad[0].error || 'falhou') + ')'; return; }
      $('pg-status').textContent = '✅ página atualizada';
      $('pg-avatar').value = ''; $('pg-capa').value = '';
      api('settings').then(function (r) { return r.json(); }).then(function (j) { if (j.ok) { state.settings = j.settings; renderPagina(); } });
      setTimeout(function () { $('pg-status').textContent = ''; }, 3000);
    }).catch(function () { $('pg-save').disabled = false; $('pg-status').textContent = 'erro de conexão'; });
  }
  $('pg-save').addEventListener('click', savePagina);

  function boot() {
    $('login').style.display = 'none';
    $('app').classList.add('on');
    showView('overview');
    loadConfig();
    load();
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(load, 60000);
  }

  // sessão existente?
  if (token()) {
    fetch('/api/admin/ping', { headers: { 'x-admin-key': token() } }).then(function (r) { if (r.ok) boot(); else logout(); }).catch(logout);
  }
})();
