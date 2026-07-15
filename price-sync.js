// Sincroniza os preços exibidos nas páginas do funil com os preços editados
// no painel (/api/settings). Sem isso, os valores ficariam fixos no HTML.
//
// Atributos suportados (a chave é "oferta/plano", ex: checkout/mensal):
//   data-price="checkout/mensal"                      -> preço do plano
//   data-price-sum="checkout/mensal+upsell/mensal"    -> soma (total)
//   data-price-diff="checkout/anual-upsell/trimestral"-> diferença (economia)
//   data-price-pct="checkout/trimestral*90"           -> 90% do preço (10% OFF)
(function () {
  function fmt(cents) { return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

  fetch('/api/settings').then(function (r) { return r.json(); }).then(function (j) {
    if (!j.ok || !j.settings || !j.settings.prices) return;
    var P = j.settings.prices;
    var get = function (k) { return P[(k || '').trim()] || 0; };

    document.querySelectorAll('[data-price]').forEach(function (el) {
      el.textContent = fmt(get(el.getAttribute('data-price')));
    });
    document.querySelectorAll('[data-price-sum]').forEach(function (el) {
      var total = el.getAttribute('data-price-sum').split('+').reduce(function (a, k) { return a + get(k); }, 0);
      el.textContent = fmt(total);
    });
    document.querySelectorAll('[data-price-diff]').forEach(function (el) {
      var p = el.getAttribute('data-price-diff').split('-');
      el.textContent = fmt(get(p[0]) - get(p[1]));
    });
    document.querySelectorAll('[data-price-pct]').forEach(function (el) {
      var p = el.getAttribute('data-price-pct').split('*');
      el.textContent = fmt(Math.round(get(p[0]) * Number(p[1]) / 100));
    });
  }).catch(function () { /* mantém os preços do HTML se a rede falhar */ });
})();
