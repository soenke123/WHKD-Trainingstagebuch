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
  deleteZone:   $("delete-zone"),
  toast:        $("toast"),

  modal:        $("modal"),
  modalTech:    $("modal-tech-chips"),
  modalFocus:   $("modal-focus-chips"),
  modalComment: $("modal-comment"),
  modalError:   $("modal-error"),
  modalDate:    $("modal-date"),
  modalDateDisp:$("modal-date-display"),
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

// Kurzform zum schnellen Scannen in den Kategorielisten:
// "heute" / "gestern" / "vor 5 T." / "12.03.25"
function relDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d);  day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff <= 0)  return "heute";
  if (diff === 1) return "gestern";
  if (diff < 30)  return `vor ${diff} T.`;
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function showToast(msg, ms = 2600) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(el.toast._t);
  el.toast._t = setTimeout(() => { el.toast.hidden = true; }, ms);
}

// Wert für <input type="datetime-local"> — lokale Zeit ohne TZ-Suffix.
function toLocalInputValue(date) {
  const off = date.getTimezoneOffset();
  const local = new Date(date.getTime() - off * 60000);
  return local.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
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
      slug: slugFromEmail(data.user.email),
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
  const [techRes, focusRes, entryRes, secRes] = await Promise.all([
    supa.from("technique_stats").select("id, name, usage_count, last_used_at"),
    supa.from("focus_area_stats").select("id, name, usage_count, last_used_at"),
    supa.from("entries")
      .select("id, comment, created_at, user_id, entry_techniques(technique_id), entry_focus_areas(focus_area_id)")
      .order("created_at", { ascending: false })
      .limit(16),
    supa.from("sections").select("slot, title, content, updated_at, updated_by").order("slot"),
  ]);

  if (techRes.error || focusRes.error || entryRes.error) {
    console.error(techRes.error || focusRes.error || entryRes.error);
    return;
  }
  // Sections dürfen fehlen (Schema evtl. noch nicht ausgeführt) — dann bleibt
  // das Dashboard nur leer, statt die ganze App zu blockieren.
  if (secRes.error) console.warn("sections nicht geladen:", secRes.error.message);

  techniques      = sortStats(techRes.data);
  focusAreas      = sortStats(focusRes.data);
  historyEntries  = entryRes.data;
  historyIndex    = 0;
  sections        = secRes.data || [];

  renderCategoryList(el.techList,  techniques,  selectedTech,  "tech");
  renderCategoryList(el.focusList, focusAreas,  selectedFocus, "focus");
  renderHistory();
  renderDashboard();
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
      <span class="cat-body">
        <span class="name"></span>
        <span class="last-date"></span>
      </span>
      <span class="count"></span>
    `;
    li.querySelector(".name").textContent      = it.name;
    li.querySelector(".last-date").textContent = relDate(it.last_used_at);
    li.querySelector(".count").textContent     = it.usage_count;
    li.addEventListener("click", () => {
      if (selectedSet.has(it.id)) selectedSet.delete(it.id);
      else                        selectedSet.add(it.id);
      li.setAttribute("aria-pressed", selectedSet.has(it.id) ? "true" : "false");
    });
    attachLongPressDelete(li, it, kind);
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
  const now = new Date();
  el.modalDate.value = toLocalInputValue(now);
  el.modalDateDisp.textContent = fmtDate(now.toISOString());
  renderToggleChips(el.modalTech,  techniques,  selectedTech,  "tech");
  renderToggleChips(el.modalFocus, focusAreas,  selectedFocus, "focus");
  el.modal.hidden = false;
  refreshIcons();
}

el.modalDate.addEventListener("change", () => {
  if (!el.modalDate.value) {
    el.modalDate.value = toLocalInputValue(new Date());
  }
  el.modalDateDisp.textContent = fmtDate(new Date(el.modalDate.value).toISOString());
});
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

  const createdAt = el.modalDate.value
    ? new Date(el.modalDate.value).toISOString()
    : new Date().toISOString();

  const { data: entry, error: entryErr } = await supa
    .from("entries")
    .insert({
      user_id: currentUser.id,
      comment: el.modalComment.value.trim() || null,
      created_at: createdAt,
    })
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

// ─── Long-Press + Drag-to-Delete ───────────────────────────────────────────
// Ablauf:
//   1. Pointerdown auf einem Listen-Element startet einen 450-ms-Timer.
//   2. Bewegt sich der Finger vorher > 10 px, wird der Timer abgebrochen
//      (dann interpretieren wir die Geste als Scroll/Tap, nicht als Long-Press).
//   3. Feuert der Timer, entsteht ein Ghost-Klon am Finger, oben erscheint die
//      rote Delete-Zone, und wir hängen Move/Up-Listener aufs `document` (nicht
//      auf das <li>). Zusätzlich sperren wir `touchmove` per preventDefault —
//      sonst würde Mobile-Safari die Geste weiter als vertikales Scrollen
//      behandeln und keine Pointermove-Events mehr an uns liefern.
//   4. Loslassen über der roten Zone → Löschen. Sonst → nur aufräumen.

const LONG_PRESS_MS = 450;
const MOVE_THRESHOLD = 10;

let dragState = null;

function attachLongPressDelete(li, item, kind) {
  let timer = null;
  let startX = 0, startY = 0;
  let activePointerId = null;
  let didDrag = false;

  const clearPre = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    activePointerId = null;
  };

  li.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (activePointerId !== null) return;
    activePointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    didDrag = false;
    timer = setTimeout(() => {
      timer = null;
      didDrag = true;
      const pid = activePointerId;
      activePointerId = null;
      startDrag(li, item, kind, pid, startX, startY);
    }, LONG_PRESS_MS);
  });

  li.addEventListener("pointermove", (e) => {
    if (e.pointerId !== activePointerId || !timer) return;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_THRESHOLD) clearPre();
  });

  li.addEventListener("pointerup", (e) => {
    if (e.pointerId === activePointerId) clearPre();
  });

  li.addEventListener("pointercancel", (e) => {
    if (e.pointerId === activePointerId) clearPre();
  });

  // Klick nach Long-Press unterdrücken — Capture-Phase, damit der weiter
  // oben registrierte Toggle-Handler nicht mehr feuert.
  li.addEventListener("click", (e) => {
    if (didDrag) {
      e.stopImmediatePropagation();
      e.preventDefault();
      didDrag = false;
    }
  }, true);
}

function startDrag(li, item, kind, pointerId, initialX, initialY) {
  const rect = li.getBoundingClientRect();
  const ghost = li.cloneNode(true);
  ghost.classList.add("cat-ghost");
  ghost.classList.remove("is-dragging");
  ghost.removeAttribute("aria-pressed");
  ghost.style.width = rect.width + "px";
  document.body.appendChild(ghost);

  li.classList.add("is-dragging");
  document.body.classList.add("is-dragging");
  el.deleteZone.hidden = false;
  el.deleteZone.classList.remove("is-hover");
  refreshIcons();

  const onMove = (e) => {
    if (e.pointerId !== pointerId) return;
    e.preventDefault();
    moveDrag(e.clientX, e.clientY);
  };
  const onUp = (e) => {
    if (e.pointerId !== pointerId) return;
    finish(e.clientX, e.clientY);
  };
  const onCancel = (e) => {
    if (e.pointerId !== pointerId) return;
    finish(null, null);
  };
  // Blockiert das Scrollen der Seite während der Drag — Mobile-Safari
  // liefert sonst keine Pointermove-Events mehr, sobald die Geste als
  // Scroll klassifiziert wurde.
  const onTouchMove = (e) => e.preventDefault();

  async function finish(x, y) {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onCancel);
    document.removeEventListener("touchmove", onTouchMove);

    const drop = x !== null && isOverDeleteZone(x, y);
    const s = dragState;
    cleanupDrag();
    if (drop && s) await deleteCategory(s.item, s.kind);
  }

  dragState = {
    li, item, kind, ghost,
    offsetX: initialX - rect.left,
    offsetY: initialY - rect.top,
  };
  moveDrag(initialX, initialY);

  document.addEventListener("pointermove", onMove, { passive: false });
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onCancel);
  document.addEventListener("touchmove", onTouchMove, { passive: false });

  if (navigator.vibrate) navigator.vibrate(15);
}

function moveDrag(x, y) {
  const g = dragState.ghost;
  g.style.left = (x - dragState.offsetX) + "px";
  g.style.top  = (y - dragState.offsetY) + "px";
  el.deleteZone.classList.toggle("is-hover", isOverDeleteZone(x, y));
}

function isOverDeleteZone(x, y) {
  if (el.deleteZone.hidden) return false;
  const r = el.deleteZone.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function cleanupDrag() {
  if (!dragState) return;
  dragState.ghost.remove();
  dragState.li.classList.remove("is-dragging");
  document.body.classList.remove("is-dragging");
  el.deleteZone.hidden = true;
  el.deleteZone.classList.remove("is-hover");
  dragState = null;
}

async function deleteCategory(item, kind) {
  if (item.usage_count > 0) {
    const noun = kind === "tech" ? "Technik" : "Schwerpunkt";
    const ok = confirm(
      `${noun} „${item.name}" wurde ${item.usage_count}× trainiert.\n\n` +
      `Wirklich löschen? Sie verschwindet dann auch aus allen bisherigen Trainings.`
    );
    if (!ok) return;
  }
  const table = kind === "tech" ? "techniques" : "focus_areas";
  const { error } = await supa.from(table).delete().eq("id", item.id);
  if (error) {
    showToast(`Konnte „${item.name}" nicht löschen: ${error.message}`, 3500);
    return;
  }
  if (kind === "tech") selectedTech.delete(item.id);
  else                 selectedFocus.delete(item.id);
  showToast(`„${item.name}" gelöscht.`);
  await refresh();
}

// ─── Dashboard: User-Farben ────────────────────────────────────────────────
// Farbe pro Nutzer wird aus dem E-Mail-Local-Part abgeleitet, damit sie
// deterministisch und ohne DB-Lookup bleibt. Bekannte Trainer sind fix
// gemappt; alles darüber hinaus fällt auf eine kleine Fallback-Palette
// zurück (Hash über den Slug), damit auch spätere Nutzer eine feste,
// unverwechselbare Farbe bekommen.

const USER_COLORS = {
  sihinghauke:  "#1a2744",   // Navy — SihingHauke
  sihingsoenke: "#c49a2a",   // Gold — SihingSoenke
};
const FALLBACK_COLORS = [
  "#0f7c8a",   // Teal
  "#4a7c59",   // Forest
  "#6b4c93",   // Purple
  "#b23a48",   // Crimson
  "#c96b1f",   // Rust
];

function slugFromEmail(email) {
  return (email || "").split("@")[0].toLowerCase();
}

function colorForUser(slug) {
  if (!slug) return "transparent";
  if (USER_COLORS[slug]) return USER_COLORS[slug];
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
}

// ─── Dashboard: State + DOM ────────────────────────────────────────────────

let sections = [];  // [{slot, title, content, updated_by, updated_at}]

const dashEl = {
  cards:        $("section-cards"),
  editorModal:  $("editor-modal"),
  editorTitle:  $("editor-title"),
  editor:       $("editor"),
  editorSave:   $("editor-save"),
  editorToolbar: document.querySelector(".editor-toolbar"),
};

let editorContext = null;  // { slot, originalBlocks: Map<text, authorSlug> }

// ─── Dashboard: Rendering ──────────────────────────────────────────────────

function renderDashboard() {
  dashEl.cards.innerHTML = "";
  for (const s of sections) {
    const card = document.createElement("article");
    card.className = "section-card";
    card.dataset.slot = String(s.slot);
    card.innerHTML = `
      <header class="section-card-head">
        <span class="section-title-text"></span>
        <button type="button" class="section-rename" aria-label="Umbenennen">
          <i data-lucide="pencil"></i>
        </button>
      </header>
      <div class="section-content rich-content" role="button" tabindex="0"
           aria-label="Bearbeiten"></div>
    `;
    card.querySelector(".section-title-text").textContent = s.title;

    const content = card.querySelector(".section-content");
    renderRichContentInto(content, s.content);

    // Klick auf die Karte öffnet den Editor — es sei denn, der Klick landet
    // auf einer Checkbox (die wird direkt umgeschaltet und gespeichert).
    content.addEventListener("click", (e) => {
      const cb = e.target.closest(".checkbox");
      if (cb) {
        e.stopPropagation();
        toggleCheckboxAndSave(cb, s.slot, content);
        return;
      }
      openEditor(s.slot);
    });
    content.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openEditor(s.slot);
      }
    });

    card.querySelector(".section-rename").addEventListener("click", (e) => {
      e.stopPropagation();
      startRename(card, s);
    });

    dashEl.cards.appendChild(card);
  }
  refreshIcons();
}

function renderRichContentInto(container, html) {
  container.innerHTML = sanitizeHtml(html || "");

  const isEmpty = !container.textContent.trim() && !container.querySelector("li");
  container.classList.toggle("is-empty", isEmpty);

  // Autorenfarbe pro Block als CSS-Variable setzen
  container.querySelectorAll("[data-author]").forEach((node) => {
    node.style.setProperty("--author", colorForUser(node.getAttribute("data-author")));
  });

  // Sicherstellen, dass jede Checkliste ein sichtbares Kästchen hat und einen
  // Zustand kennt — falls das gespeicherte HTML das mal verloren haben sollte.
  container.querySelectorAll("ul.checklist > li").forEach((li) => {
    if (!li.hasAttribute("data-check")) li.setAttribute("data-check", "false");
    if (!li.querySelector(":scope > .checkbox")) {
      const cb = document.createElement("span");
      cb.className = "checkbox";
      li.insertBefore(cb, li.firstChild);
    }
  });
}

// ─── Dashboard: Titel umbenennen (inline) ──────────────────────────────────

function startRename(card, section) {
  const head = card.querySelector(".section-card-head");
  const span = head.querySelector(".section-title-text");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "section-title-input";
  input.value = section.title;
  input.maxLength = 40;
  span.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const newTitle = input.value.trim();
    input.replaceWith(span);
    if (!save || !newTitle || newTitle === section.title) return;
    const { error } = await supa.from("sections")
      .update({ title: newTitle })
      .eq("slot", section.slot);
    if (error) {
      showToast(`Umbenennen fehlgeschlagen: ${error.message}`, 3500);
      return;
    }
    section.title = newTitle;
    span.textContent = newTitle;
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter")  { e.preventDefault(); finish(true);  }
    if (e.key === "Escape") { e.preventDefault(); finish(false); }
  });
  input.addEventListener("blur", () => finish(true));
}

// ─── Dashboard: Editor öffnen / schließen / speichern ─────────────────────

function openEditor(slot) {
  const s = sections.find((x) => x.slot === slot);
  if (!s) return;
  dashEl.editorTitle.textContent = s.title;
  renderRichContentInto(dashEl.editor, s.content);
  // Checkboxen im Editor als contenteditable="false" markieren, damit sie
  // beim Tippen nicht kaputtgehen.
  dashEl.editor.querySelectorAll(".checkbox").forEach((cb) => {
    cb.setAttribute("contenteditable", "false");
  });
  editorContext = { slot, originalBlocks: extractBlocks(s.content) };
  dashEl.editorModal.hidden = false;
  refreshIcons();
  setTimeout(() => dashEl.editor.focus(), 50);
}

function closeEditor() {
  dashEl.editorModal.hidden = true;
  dashEl.editor.innerHTML = "";
  editorContext = null;
}

dashEl.editorModal.querySelectorAll("[data-editor-close]").forEach((n) => {
  n.addEventListener("click", closeEditor);
});

// Toolbar
dashEl.editorToolbar.addEventListener("mousedown", (e) => {
  // Verhindert, dass ein Klick auf einen Button den Fokus aus dem Editor
  // herauszieht — sonst geht die Selektion verloren und execCommand hat
  // nichts, worauf es angewendet werden kann.
  if (e.target.closest("button")) e.preventDefault();
});

dashEl.editorToolbar.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-cmd]");
  if (!btn) return;
  dashEl.editor.focus();
  // Tag-basiertes Markup erzwingen (sonst spuckt Chrome <span style="…">
  // aus, was der Sanitizer bei der nächsten Runde wieder rauswirft).
  try { document.execCommand("styleWithCSS", false, false); } catch (_) {}
  switch (btn.dataset.cmd) {
    case "bold":   document.execCommand("bold");   break;
    case "italic": document.execCommand("italic"); break;
    case "ul":     document.execCommand("insertUnorderedList"); break;
    case "ol":     document.execCommand("insertOrderedList");   break;
    case "check":  makeChecklistAtCursor(); break;
  }
});

function makeChecklistAtCursor() {
  document.execCommand("insertUnorderedList");
  // Der frisch eingefügten UL die Checklisten-Klasse verpassen und in jeder
  // LI eine leere Checkbox platzieren.
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  let node = sel.anchorNode;
  while (node && node.nodeName !== "UL" && node !== dashEl.editor) node = node.parentNode;
  if (!node || node.nodeName !== "UL") return;
  node.classList.add("checklist");
  node.querySelectorAll(":scope > li").forEach((li) => {
    if (!li.hasAttribute("data-check")) li.setAttribute("data-check", "false");
    if (!li.querySelector(":scope > .checkbox")) {
      const cb = document.createElement("span");
      cb.className = "checkbox";
      cb.setAttribute("contenteditable", "false");
      li.insertBefore(cb, li.firstChild);
    }
  });
}

// Klick auf eine Checkbox im Editor: nur den Zustand toggeln, nicht speichern
// (Speichern passiert erst beim Klick auf „Fertig").
dashEl.editor.addEventListener("click", (e) => {
  const cb = e.target.closest(".checkbox");
  if (!cb) return;
  const li = cb.closest("li[data-check]");
  if (!li) return;
  li.setAttribute("data-check", li.getAttribute("data-check") === "true" ? "false" : "true");
});

// Paste als Plaintext — verhindert, dass Word/Notes-HTML in unser Datenmodell
// einsickert. Sanitize würde es zwar filtern, aber so ist das UX vorhersehbar.
dashEl.editor.addEventListener("paste", (e) => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData("text/plain");
  document.execCommand("insertText", false, text);
});

dashEl.editorSave.addEventListener("click", async () => {
  if (!editorContext) return;
  const { slot, originalBlocks } = editorContext;
  dashEl.editorSave.disabled = true;
  const mySlug = currentUser ? currentUser.slug : "";
  const attributed = attributeBlocks(dashEl.editor.innerHTML, originalBlocks, mySlug);
  const err = await persistSection(slot, attributed);
  dashEl.editorSave.disabled = false;
  if (err) return;
  closeEditor();
});

// Checkbox-Toggle in der Read-Ansicht: Zustand flippen und direkt speichern,
// ohne die Blöcke neu zu attributieren (der Autor eines Punkts soll durch
// bloßes Abhaken nicht wechseln).
async function toggleCheckboxAndSave(checkbox, slot, container) {
  const li = checkbox.closest("li[data-check]");
  if (!li) return;
  li.setAttribute("data-check", li.getAttribute("data-check") === "true" ? "false" : "true");
  await persistSection(slot, container.innerHTML);
}

async function persistSection(slot, html) {
  const clean = sanitizeHtml(html);
  const { error } = await supa.from("sections")
    .update({
      content: clean,
      updated_by: currentUser ? currentUser.id : null,
      updated_at: new Date().toISOString(),
    })
    .eq("slot", slot);
  if (error) {
    showToast(`Speichern fehlgeschlagen: ${error.message}`, 3500);
    return error;
  }
  const s = sections.find((x) => x.slot === slot);
  if (s) s.content = clean;
  const card = dashEl.cards.querySelector(`.section-card[data-slot="${slot}"]`);
  if (card) {
    renderRichContentInto(card.querySelector(".section-content"), clean);
    refreshIcons();
  }
  return null;
}

// ─── Dashboard: Block-Autorenschaft ────────────────────────────────────────
// Auf Block-Ebene (Absatz / Listenpunkt) merken wir uns per data-author, wer
// den Text zuletzt geschrieben hat. Heuristik beim Speichern:
//   • Wenn der Text eines Blocks unverändert in der Ursprungs-Map vorkommt,
//     bleibt der ursprüngliche Autor erhalten.
//   • Alles andere (neu, editiert, verschoben mit anderem Text) wird dem
//     aktuellen Nutzer zugeschrieben.
// Kollisionen bei identischem Text (mehrere Blöcke mit gleichem Inhalt) sind
// bewusst egal — sie hätten sowieso den gleichen Autor.

function extractBlocks(html) {
  const map = new Map();
  const template = document.createElement("template");
  template.innerHTML = html || "";
  walkBlocks(template.content, (block) => {
    const text = block.textContent.trim();
    const author = block.getAttribute("data-author");
    if (text && author && !map.has(text)) map.set(text, author);
  });
  return map;
}

function attributeBlocks(html, originalMap, currentSlug) {
  const template = document.createElement("template");
  template.innerHTML = html || "";
  normalizeToBlocks(template.content);
  walkBlocks(template.content, (block) => {
    const text = block.textContent.trim();
    if (!text) { block.removeAttribute("data-author"); return; }
    const original = originalMap.get(text);
    block.setAttribute("data-author", original || currentSlug || "");
  });
  return template.innerHTML;
}

// Ruft `visit` für jeden „Block" auf: Top-Level-Elemente außer Listen, sowie
// jedes <li> innerhalb einer Liste (rekursiv).
function walkBlocks(root, visit) {
  for (const child of Array.from(root.children)) {
    if (child.tagName === "UL" || child.tagName === "OL") {
      for (const li of Array.from(child.children)) visit(li);
    } else {
      visit(child);
    }
  }
}

// Rohes contenteditable-HTML in eine klare Block-Struktur bringen: nackte
// Textknoten und Inline-Elemente werden in <p> verpackt, <br> zwischen
// solchen Runs zerlegt die Absätze. Firefox liefert sonst „foo<br>bar"
// statt „<p>foo</p><p>bar</p>", was uns die Block-Attribution kaputt macht.
const INLINE_TAGS  = new Set(["STRONG", "B", "EM", "I", "U", "SPAN", "A", "CODE"]);
const BLOCK_TAGS   = new Set(["P", "DIV", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE"]);

function normalizeToBlocks(root) {
  const kids = Array.from(root.childNodes);
  let currentP = null;
  for (const kid of kids) {
    if (kid.nodeType === Node.ELEMENT_NODE && kid.tagName === "BR") {
      // <br> auf Top-Level schließt den aktuellen Absatz und wird verworfen.
      currentP = null;
      kid.remove();
      continue;
    }
    if (kid.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(kid.tagName)) {
      currentP = null;
      continue;
    }
    if (kid.nodeType === Node.TEXT_NODE && !kid.textContent.trim()) {
      // Reines Whitespace zwischen Blöcken ignorieren.
      continue;
    }
    if (kid.nodeType === Node.ELEMENT_NODE && !INLINE_TAGS.has(kid.tagName)) {
      // Unbekanntes Element: nicht anpacken, aktuelles <p> schließen.
      currentP = null;
      continue;
    }
    if (!currentP) {
      currentP = document.createElement("p");
      root.insertBefore(currentP, kid);
    }
    currentP.appendChild(kid);
  }
}

// ─── Dashboard: HTML-Sanitizer ─────────────────────────────────────────────
// Whitelist-basierter Filter. Der Editor speist uns fast beliebiges HTML ein
// (execCommand, Paste), deshalb filtern wir sowohl beim Speichern als auch
// beim Rendern.

const ALLOWED_TAGS = new Set([
  "P", "BR", "STRONG", "B", "EM", "I", "U",
  "UL", "OL", "LI", "DIV", "SPAN", "H3",
]);

function isAttrAllowed(tag, attr) {
  if (attr === "data-author") return true;
  if (tag === "LI"   && attr === "data-check") return true;
  if (tag === "UL"   && attr === "class")      return true;
  if (tag === "SPAN" && attr === "class")      return true;
  return false;
}

function isClassValid(tag, cls) {
  if (tag === "UL")   return cls === "checklist";
  if (tag === "SPAN") return cls === "checkbox";
  return false;
}

function sanitizeHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html || "";
  cleanContainer(template.content);
  return template.innerHTML;
}

function cleanContainer(container) {
  const kids = Array.from(container.childNodes);
  for (const kid of kids) {
    if (kid.nodeType === Node.TEXT_NODE) continue;
    if (kid.nodeType !== Node.ELEMENT_NODE) { kid.remove(); continue; }

    // Legacy-Formatierung normalisieren
    let tag = kid.tagName;
    if (tag === "B") tag = "STRONG";
    if (tag === "I") tag = "EM";

    if (!ALLOWED_TAGS.has(tag)) {
      // Unwrap: Kinder an Ort und Stelle übernehmen, dann Element entfernen.
      while (kid.firstChild) kid.parentNode.insertBefore(kid.firstChild, kid);
      kid.remove();
      // Kids-Snapshot ist jetzt stale; einmal von vorn.
      cleanContainer(container);
      return;
    }

    if (tag !== kid.tagName) {
      const rep = document.createElement(tag.toLowerCase());
      for (const a of Array.from(kid.attributes)) {
        if (isAttrAllowed(tag, a.name)) rep.setAttribute(a.name, a.value);
      }
      while (kid.firstChild) rep.appendChild(kid.firstChild);
      kid.parentNode.replaceChild(rep, kid);
      cleanContainer(rep);
      continue;
    }

    for (const a of Array.from(kid.attributes)) {
      if (!isAttrAllowed(tag, a.name)) { kid.removeAttribute(a.name); continue; }
      if (a.name === "class" && !isClassValid(tag, a.value)) kid.removeAttribute("class");
    }
    cleanContainer(kid);
  }
}

// ─── Start ─────────────────────────────────────────────────────────────────

checkSession();
