// WHKD Trainingstagebuch — Frontend
// Vanilla JS, kein Framework. Kommunikation mit Supabase über das UMD-SDK
// (window.supabase), das in index.html per CDN geladen wird.

const EMAIL_DOMAIN = "whkd.local";

const supa = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY
);

// ─── Icon-Mapping (Lucide-Icon-Namen) ──────────────────────────────────────

const TECH_ICONS = {
  "Basis":               "circle-dot",
  "Tabellen":            "table",
  "Handkombinationen":   "hand-metal",
  "Trittkombinationen":  "footprints",
  "Offensiv Setups":     "sword",
  "Defensiv Setups":     "shield",
  "Würfe":               "rotate-cw",
  "Chin-Na Techniken":   "link-2",
  "Falltritte":          "chevrons-down",
  "Greifkonter":         "grab",
  "Schlagkonter":        "shield-alert",
  "Trittkonter":         "shield-check",
  "Messerkonter":        "scissors",
  "Stockkonter":         "wand-2",
  "Waffentraining":      "swords",
  "Escrima":             "wand-sparkles",
};

const FOCUS_ICONS = {
  "Beine":               "footprints",
  "Arme":                "hand",
  "Rumpf":               "shirt",
  "Kondition":           "heart-pulse",
  "Kraft":               "dumbbell",
  "Pratze/Airbag":       "target",
  "Multiman":            "users",
  "Todmachertraining":   "skull",
};

function iconFor(kind, name) {
  const map = kind === "tech" ? TECH_ICONS : FOCUS_ICONS;
  return map[name] || "circle";
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

// ─── DOM-Handles ───────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const el = {
  login:        $("login"),
  loginForm:    $("login-form"),
  loginUser:    $("login-username"),
  loginPass:    $("login-password"),
  loginError:   $("login-error"),

  app:          $("app"),
  logout:       $("logout-btn"),

  tabButtons:   document.querySelectorAll(".tab"),
  tabTagebuch:  $("tab-tagebuch"),
  tabDashboard: $("tab-dashboard"),

  lastTraining: $("last-training"),
  lastTitle:    $("last-title"),
  lastAuthor:   $("last-author"),
  lastDate:     $("last-date"),
  lastTech:     $("last-techniques"),
  lastFocus:    $("last-focus"),
  lastComment:  $("last-comment"),
  noTraining:   $("no-training"),

  histPrev:     $("hist-prev"),
  histNext:     $("hist-next"),
  histIndicator:$("hist-indicator"),

  techList:     $("tech-list"),
  focusList:    $("focus-list"),

  fab:          $("fab"),

  modal:        $("modal"),
  modalTech:    $("modal-tech-chips"),
  modalFocus:   $("modal-focus-chips"),
  modalComment: $("modal-comment"),
  modalError:   $("modal-error"),
  saveBtn:      $("save-btn"),

  newTechForm:   $("new-tech-form"),
  newTechInput:  $("new-tech-input"),
  newFocusForm:  $("new-focus-form"),
  newFocusInput: $("new-focus-input"),
};

// ─── State ─────────────────────────────────────────────────────────────────

let techniques = [];             // [{id, name, usage_count}]
let focusAreas = [];
let selectedTech  = new Set();
let selectedFocus = new Set();

let currentUser    = null;       // { id, email, name }
let historyEntries = [];         // letzte bis zu 16 Trainings, entries[0] = neuestes
let historyIndex   = 0;          // 0 = neuestes, größer = älter

// ─── Helpers ───────────────────────────────────────────────────────────────

function usernameToEmail(u) {
  return `${u.trim().toLowerCase()}@${EMAIL_DOMAIN}`;
}

function displayName(email) {
  if (!email) return "";
  const local = email.split("@")[0].toLowerCase();
  if (local === "sihinghauke")  return "SihingHauke";
  if (local === "sihingsoenke") return "SihingSoenke";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })
       + " · " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function showError(node, msg) {
  node.textContent = msg;
  node.hidden = false;
}
function clearError(node) {
  node.textContent = "";
  node.hidden = true;
}

// Der andere Trainer — wir haben genau zwei Konten.
function authorFor(userId) {
  if (currentUser && currentUser.id === userId) return currentUser.name;
  if (currentUser) {
    return currentUser.name === "SihingHauke" ? "SihingSoenke" : "SihingHauke";
  }
  return "Trainer";
}

// ─── Auth ──────────────────────────────────────────────────────────────────

async function checkSession() {
  const { data } = await supa.auth.getSession();
  if (data.session) await enterApp();
  else {
    el.login.hidden = false;
    el.app.hidden = true;
  }
}

el.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError(el.loginError);
  const email = usernameToEmail(el.loginUser.value);
  const { error } = await supa.auth.signInWithPassword({
    email,
    password: el.loginPass.value,
  });
  if (error) {
    showError(el.loginError, "Login fehlgeschlagen. Benutzername oder Passwort prüfen.");
    return;
  }
  el.loginPass.value = "";
  await enterApp();
});

el.logout.addEventListener("click", async () => {
  await supa.auth.signOut();
  currentUser = null;
  el.app.hidden = true;
  el.login.hidden = false;
});

async function enterApp() {
  el.login.hidden = true;
  el.app.hidden = false;
  const { data } = await supa.auth.getUser();
  if (data.user) {
    currentUser = {
      id: data.user.id,
      email: data.user.email,
      name: displayName(data.user.email),
    };
  }
  await refresh();
}

// ─── Tabs ──────────────────────────────────────────────────────────────────

el.tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.tab;
    el.tabButtons.forEach((b) => {
      const active = b.dataset.tab === target;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-selected", active ? "true" : "false");
    });
    el.tabTagebuch.hidden  = target !== "tagebuch";
    el.tabDashboard.hidden = target !== "dashboard";
  });
});

// ─── Daten laden & rendern ─────────────────────────────────────────────────

async function refresh() {
  const [techRes, focusRes, entryRes] = await Promise.all([
    supa.from("technique_stats").select("id, name, usage_count"),
    supa.from("focus_area_stats").select("id, name, usage_count"),
    supa.from("entries")
      .select("id, comment, created_at, user_id, entry_techniques(technique_id), entry_focus_areas(focus_area_id)")
      .order("created_at", { ascending: false })
      .limit(16),
  ]);

  if (techRes.error || focusRes.error || entryRes.error) {
    console.error(techRes.error || focusRes.error || entryRes.error);
    return;
  }

  techniques      = sortStats(techRes.data);
  focusAreas      = sortStats(focusRes.data);
  historyEntries  = entryRes.data;
  historyIndex    = 0;

  renderCategoryList(el.techList,  techniques,  selectedTech,  "tech");
  renderCategoryList(el.focusList, focusAreas,  selectedFocus, "focus");
  renderHistory();
  refreshIcons();
}

function sortStats(rows) {
  return [...rows].sort((a, b) =>
    a.usage_count - b.usage_count || a.name.localeCompare(b.name, "de")
  );
}

function renderCategoryList(root, items, selectedSet, kind) {
  root.innerHTML = "";
  for (const it of items) {
    const li = document.createElement("li");
    li.setAttribute("aria-pressed", selectedSet.has(it.id) ? "true" : "false");
    li.dataset.id = String(it.id);
    li.innerHTML = `
      <span class="cat-check" aria-hidden="true"></span>
      <i data-lucide="${iconFor(kind, it.name)}" class="cat-icon"></i>
      <span class="name"></span>
      <span class="count"></span>
    `;
    li.querySelector(".name").textContent  = it.name;
    li.querySelector(".count").textContent = it.usage_count;
    li.addEventListener("click", () => {
      if (selectedSet.has(it.id)) selectedSet.delete(it.id);
      else                        selectedSet.add(it.id);
      li.setAttribute("aria-pressed", selectedSet.has(it.id) ? "true" : "false");
    });
    root.appendChild(li);
  }
}

// ─── Letztes Training + History-Navigation ─────────────────────────────────

function renderHistory() {
  if (!historyEntries.length) {
    el.lastTraining.hidden = true;
    el.noTraining.hidden = false;
    return;
  }
  el.noTraining.hidden = true;
  el.lastTraining.hidden = false;

  if (historyIndex >= historyEntries.length) historyIndex = historyEntries.length - 1;
  if (historyIndex < 0) historyIndex = 0;

  const entry = historyEntries[historyIndex];

  el.lastTitle.textContent  = historyIndex === 0
    ? "Letztes Training"
    : `Vor ${historyIndex} Trainings`;
  el.lastAuthor.textContent = authorFor(entry.user_id);
  el.lastDate.textContent   = fmtDate(entry.created_at);

  el.histIndicator.textContent = `${historyIndex + 1}/${historyEntries.length}`;
  el.histPrev.disabled = historyIndex === 0;
  el.histNext.disabled = historyIndex === historyEntries.length - 1;

  const techItems = entry.entry_techniques
    .map((r) => techniques.find((t) => t.id === r.technique_id))
    .filter(Boolean);
  const focusItems = entry.entry_focus_areas
    .map((r) => focusAreas.find((f) => f.id === r.focus_area_id))
    .filter(Boolean);

  fillChipList(el.lastTech,  techItems,  "tech");
  fillChipList(el.lastFocus, focusItems, "focus");

  if (entry.comment && entry.comment.trim().length) {
    el.lastComment.textContent = entry.comment;
    el.lastComment.hidden = false;
  } else {
    el.lastComment.hidden = true;
  }

  refreshIcons();
}

function fillChipList(root, items, kind) {
  root.innerHTML = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.textContent = "–";
    li.style.color = "var(--muted)";
    li.style.border = "0";
    root.appendChild(li);
    return;
  }
  for (const it of items) {
    const li = document.createElement("li");
    li.innerHTML = `<i data-lucide="${iconFor(kind, it.name)}"></i><span></span>`;
    li.querySelector("span").textContent = it.name;
    root.appendChild(li);
  }
}

// Nav-Buttons + Swipe
el.histPrev.addEventListener("click", () => navigateHistory(-1));
el.histNext.addEventListener("click", () => navigateHistory(+1));

function navigateHistory(delta) {
  const next = historyIndex + delta;
  if (next < 0 || next >= historyEntries.length) return;
  historyIndex = next;
  renderHistory();
}

// Horizontaler Swipe auf der Karte: links = älter, rechts = neuer.
let touchStartX = 0, touchStartY = 0;
el.lastTraining.addEventListener("touchstart", (e) => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });
el.lastTraining.addEventListener("touchend", (e) => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx)) return;
  navigateHistory(dx < 0 ? +1 : -1);
}, { passive: true });

// ─── Modal ─────────────────────────────────────────────────────────────────

el.fab.addEventListener("click", openModal);
el.modal.querySelectorAll("[data-close]").forEach((n) =>
  n.addEventListener("click", closeModal)
);

function openModal() {
  clearError(el.modalError);
  el.modalComment.value = "";
  renderToggleChips(el.modalTech,  techniques,  selectedTech,  "tech");
  renderToggleChips(el.modalFocus, focusAreas,  selectedFocus, "focus");
  el.modal.hidden = false;
  refreshIcons();
}
function closeModal() {
  el.modal.hidden = true;
}

function renderToggleChips(root, items, selectedSet, kind) {
  root.innerHTML = "";
  for (const it of items) {
    const li = document.createElement("li");
    li.dataset.id = String(it.id);
    li.setAttribute("aria-pressed", selectedSet.has(it.id) ? "true" : "false");
    li.innerHTML = `<i data-lucide="${iconFor(kind, it.name)}"></i><span></span>`;
    li.querySelector("span").textContent = it.name;
    li.addEventListener("click", () => {
      if (selectedSet.has(it.id)) selectedSet.delete(it.id);
      else                        selectedSet.add(it.id);
      li.setAttribute("aria-pressed", selectedSet.has(it.id) ? "true" : "false");
    });
    root.appendChild(li);
  }
}

// ─── Neue Kategorien inline anlegen ────────────────────────────────────────

el.newTechForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  await addCategory("techniques", el.newTechInput, selectedTech, el.modalTech, "tech");
});
el.newFocusForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  await addCategory("focus_areas", el.newFocusInput, selectedFocus, el.modalFocus, "focus");
});

async function addCategory(table, input, selectedSet, chipsRoot, kind) {
  const name = input.value.trim();
  if (!name) return;
  clearError(el.modalError);

  const { data, error } = await supa.from(table).insert({ name }).select().single();
  if (error) {
    showError(el.modalError, `Konnte "${name}" nicht anlegen: ${error.message}`);
    return;
  }
  input.value = "";
  const row = { id: data.id, name: data.name, usage_count: 0 };
  if (kind === "tech") techniques = sortStats([...techniques, row]);
  else                 focusAreas = sortStats([...focusAreas, row]);
  selectedSet.add(data.id);

  renderToggleChips(chipsRoot,
    kind === "tech" ? techniques : focusAreas,
    selectedSet, kind
  );
  renderCategoryList(el.techList,  techniques,  selectedTech,  "tech");
  renderCategoryList(el.focusList, focusAreas,  selectedFocus, "focus");
  refreshIcons();
}

// ─── Speichern ─────────────────────────────────────────────────────────────

el.saveBtn.addEventListener("click", async () => {
  clearError(el.modalError);
  el.saveBtn.disabled = true;

  if (!currentUser) {
    showError(el.modalError, "Session verloren, bitte neu anmelden.");
    el.saveBtn.disabled = false;
    return;
  }

  const { data: entry, error: entryErr } = await supa
    .from("entries")
    .insert({ user_id: currentUser.id, comment: el.modalComment.value.trim() || null })
    .select()
    .single();

  if (entryErr) {
    showError(el.modalError, entryErr.message);
    el.saveBtn.disabled = false;
    return;
  }

  const techRows  = [...selectedTech ].map((id) => ({ entry_id: entry.id, technique_id: id }));
  const focusRows = [...selectedFocus].map((id) => ({ entry_id: entry.id, focus_area_id: id }));

  const [tRes, fRes] = await Promise.all([
    techRows.length  ? supa.from("entry_techniques" ).insert(techRows ) : Promise.resolve({ error: null }),
    focusRows.length ? supa.from("entry_focus_areas").insert(focusRows) : Promise.resolve({ error: null }),
  ]);
  if (tRes.error || fRes.error) {
    showError(el.modalError, (tRes.error || fRes.error).message);
    el.saveBtn.disabled = false;
    return;
  }

  selectedTech.clear();
  selectedFocus.clear();
  el.saveBtn.disabled = false;
  closeModal();
  await refresh();
});

// ─── Start ─────────────────────────────────────────────────────────────────

checkSession();
