const DEFAULTS = { mode: "folder", subfolder: "Videos" };
const $ = (id) => document.getElementById(id);

function renderHint(mode, sub) {
  $("subfolder").disabled = mode === "ask";
  $("hint").innerHTML = mode === "ask"
    ? "A janela “Salvar como” vai abrir a cada download."
    : "Salvando em <code>Downloads/" + (sub ? sub.replace(/^\/+|\/+$/g, "") + "/" : "") + "</code>";
}

function flashSaved() {
  const s = $("saved");
  s.classList.add("show");
  setTimeout(() => s.classList.remove("show"), 1200);
}

function save() {
  const mode = $("ask").checked ? "ask" : "folder";
  const subfolder = $("subfolder").value.trim();
  chrome.storage.local.set({ mode, subfolder }, flashSaved);
  renderHint(mode, subfolder);
}

chrome.storage.local.get(DEFAULTS, (o) => {
  $("ask").checked = o.mode === "ask";
  $("folder").checked = o.mode !== "ask";
  $("subfolder").value = o.subfolder || "";
  renderHint(o.mode, o.subfolder);
});

$("ask").addEventListener("change", save);
$("folder").addEventListener("change", save);
$("subfolder").addEventListener("input", save);
