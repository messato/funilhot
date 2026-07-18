// Aplica na landing o conteúdo editado no painel (/api/settings): textos com
// [data-field] e as imagens (avatar/capa) servidas de /img. Sem valor salvo,
// mantém o que já está no HTML.
(function () {
  fetch('/api/settings').then(function (r) { return r.json(); }).then(function (j) {
    if (!j.ok || !j.settings) return;
    var s = j.settings;
    document.querySelectorAll('[data-field]').forEach(function (el) {
      var v = s[el.getAttribute('data-field')];
      if (v != null && v !== '') el.textContent = v;
    });
    if (s.capaVer) { var c = document.querySelector('.capa'); if (c) c.src = '/img/capa?v=' + s.capaVer; }
    if (s.avatarVer) { var a = document.querySelector('.avatar'); if (a) a.src = '/img/avatar?v=' + s.avatarVer; }
    if (s.logoVer) { var lg = document.querySelector('.header img'); if (lg) lg.src = '/img/logo?v=' + s.logoVer; }
  }).catch(function () { /* mantém o HTML padrão se falhar */ });
})();
