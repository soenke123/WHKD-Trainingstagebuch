// WHKD Trainingstagebuch — Frontend
// Vanilla JS, kein Framework. Kommunikation mit Supabase über das UMD-SDK
// (window.supabase), das in index.html per CDN geladen wird.

const EMAIL_DOMAIN = "whkd.local";

const supa = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY
);

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
  lastAuthor:   $("last-author"),
  lastDate:     $("last-date"),
  lastTech:     $("last-techniques"),
  lastFocus:    $("last-focus"),
  lastComment:  $("last-comment"),
  noTraining:   $("no-training"),

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

let techniques = [];       // [{id, name, usage_count}]
let focusAreas = [];       // [{id, name, usage_count}]
let selectedTech  = new Set();  // Set<number>
let selectedFocus = new Set();

// ─── Helpers ───────────────────────────────────────────────────────────────

function usernameToEmail(u) {
  return `${u.trim().toLowerCase()}@${EMAIL_DOMAIN}`;
}

function displayName(email) {
  if (!email) return "";
  const local = email.split("@")[0];
  // sihinghauke → SihingHauke; sihingsoenke → SihingSoenke
  return local.charAt(0).toUpperCase() + local.slice(1).replace(/^sihing/i, "Sihing");
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

// ─── Auth ──────────────────────────────────────────────────────────────────

async function checkSession() {
  const { data } = await supa.auth.getSession();
  if (data.session) {
    await enterApp();
  } else {
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
  el.app.hidden = true;
  el.login.hidden = false;
});

async function enterApp() {
  el.login.hidden = true;
  el.app.hidden = false;
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

  techniques = sortStats(techRes.data);
  focusAreas = sortStats(focusRes.data);

  renderCategoryList(el.techList,  techniques,  selectedTech);
  renderCategoryList(el.focusList, focusAreas,  selectedFocus);
  renderLastTraining(entryRes.data);
}

function sortStats(rows) {
  return [...rows].sort((a, b) =>
    a.usage_count - b.usage_count || a.name.localeCompare(b.name, "de")
  );
}

function renderCategoryList(root, items, selectedSet) {
  root.innerHTML = "";
  for (const it of items) {
    const li = document.createElement("li");
    li.setAttribute("aria-pressed", selectedSet.has(it.id) ? "true" : "false");
    li.dataset.id = String(it.id);
    li.innerHTML = `
      <span class="cat-check" aria-hidden="true"></span>
      <span class="name"></span>
      <span class="count"></span>
    `;
    li.querySelector(".name").textContent = it.name;
    li.querySelector(".count").textContent = it.usage_count;
    li.addEventListener("click", () => {
      if (selectedSet.has(it.id)) selectedSet.delete(it.id);
      else                        selectedSet.add(it.id);
      li.setAttribute("aria-pressed", selectedSet.has(it.id) ? "true" : "false");
    });
    root.appendChild(li);
  }
}

async function renderLastTraining(entries) {
  if (!entries.length) {
    el.lastTraining.hidden = true;
    el.noTraining.hidden = false;
    return;
  }
  el.noTraining.hidden = true;
  el.lastTraining.hidden = false;

  const last = entries[0];

  // Autor-Anzeige: hole E-Mail aus auth.users über einen kleinen Umweg.
  // Wir haben keinen Profil-Table, aber wir kennen unseren eigenen User
  // (via getUser) und die Konvention SihingHauke / SihingSoenke.
  // Für andere IDs fallen wir zurück auf "Trainer".
  const { data: userData } = await supa.auth.getUser();
  let author = "Trainer";
  if (userData.user && userData.user.id === last.user_id) {
    author = displayName(userData.user.email);
  } else {
    // Wir wissen: es gibt nur 2 Nutzer. Der andere ist folglich der jeweils andere Name.
    if (userData.user) {
      const me = displayName(userData.user.email);
      author = me.toLowerCase().includes("hauke") ? "SihingSoenke" : "SihingHauke";
    }
  }
  el.lastAuthor.textContent = author;
  el.lastDate.textContent   = fmtDate(last.created_at);

  const techNames  = last.entry_techniques
    .map((r) => techniques.find((t) => t.id === r.technique_id)?.name)
    .filter(Boolean);
  const focusNames = last.entry_focus_areas
    .map((r) => focusAreas.find((f) => f.id === r.focus_area_id)?.name)
    .filter(Boolean);

  fillChipList(el.lastTech,  techNames);
  fillChipList(el.lastFocus, focusNames);

  if (last.comment && last.comment.trim().length) {
    el.lastComment.textContent = last.comment;
    el.lastComment.hidden = false;
  } else {
    el.lastComment.hidden = true;
  }
}

function fillChipList(root, names) {
  root.innerHTML = "";
  if (!names.length) {
    const li = document.createElement("li");
    li.textContent = "–";
    li.style.color = "var(--muted)";
    root.appendChild(li);
    return;
  }
  for (const n of names) {
    const li = document.createElement("li");
    li.textContent = n;
    root.appendChild(li);
  }
}

// ─── Modal ─────────────────────────────────────────────────────────────────

el.fab.addEventListener("click", openModal);
el.modal.querySelectorAll("[data-close]").forEach((n) =>
  n.addEventListener("click", closeModal)
);

function openModal() {
  clearError(el.modalError);
  el.modalComment.value = "";
  renderToggleChips(el.modalTech,  techniques,  selectedTech);
  renderToggleChips(el.modalFocus, focusAreas,  selectedFocus);
  el.modal.hidden = false;
}
function closeModal() {
  el.modal.hidden = true;
}

function renderToggleChips(root, items, selectedSet) {
  root.innerHTML = "";
  for (const it of items) {
    const li = document.createElement("li");
    li.textContent = it.name;
    li.dataset.id = String(it.id);
    li.setAttribute("aria-pressed", selectedSet.has(it.id) ? "true" : "false");
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
  // Lokal einfügen mit Count 0 und direkt auswählen
  const row = { id: data.id, name: data.name, usage_count: 0 };
  if (kind === "tech")  techniques  = sortStats([...techniques,  row]);
  else                  focusAreas  = sortStats([...focusAreas,  row]);
  selectedSet.add(data.id);
  renderToggleChips(chipsRoot,
    kind === "tech" ? techniques : focusAreas,
    selectedSet
  );
  // Auch die Haupt-Kategorienlisten dahinter aktualisieren
  renderCategoryList(el.techList,  techniques,  selectedTech);
  renderCategoryList(el.focusList, focusAreas,  selectedFocus);
}

// ─── Speichern ─────────────────────────────────────────────────────────────

el.saveBtn.addEventListener("click", async () => {
  clearError(el.modalError);
  el.saveBtn.disabled = true;

  const { data: userData, error: userErr } = await supa.auth.getUser();
  if (userErr || !userData.user) {
    showError(el.modalError, "Session verloren, bitte neu anmelden.");
    el.saveBtn.disabled = false;
    return;
  }

  const { data: entry, error: entryErr } = await supa
    .from("entries")
    .insert({ user_id: userData.user.id, comment: el.modalComment.value.trim() || null })
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

  // Auswahl zurücksetzen, Modal schließen, neu laden
  selectedTech.clear();
  selectedFocus.clear();
  el.saveBtn.disabled = false;
  closeModal();
  await refresh();
});

// ─── Start ─────────────────────────────────────────────────────────────────

checkSession();
