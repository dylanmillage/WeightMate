// WeightMate 2.0 - app.js
// Personal lifting tracker: live workout sessions, deep lift analytics, friends.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, doc, deleteDoc, updateDoc, query, orderBy, serverTimestamp, where, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD5p9eWhfXP93ephwkcg1ZEuqAdihS78eA",
  authDomain: "millage-weightmate.firebaseapp.com",
  projectId: "millage-weightmate",
  storageBucket: "millage-weightmate.firebasestorage.app",
  messagingSenderId: "368905572653",
  appId: "1:368905572653:web:c4b56928cc5a6b9be043a4"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ─── SMALL HELPERS ────────────────────────────────────────────────────────────
const TOAST_ICONS = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠', pr: '🏆' };
function toast(message, type = 'info', duration = 3400) {
  const el = document.createElement('div');
  el.className = `toast toast-${type === 'pr' ? 'success' : type}`;
  el.innerHTML = `<span style="font-size:15px;flex-shrink:0;">${TOAST_ICONS[type]||'ℹ'}</span><span>${message}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => {
    el.classList.add('toast-exit');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ─── SETTINGS (device-level preferences, stored locally) ─────────────────────
const SETTINGS_KEY = 'wm_settings';
const DEFAULT_SETTINGS = { accent: '#2f81f7', weightStep: 5, restDefault: 90, autoRest: true, haptics: true };
const ACCENT_PRESETS = [
  { name: 'Blue',   hex: '#2f81f7' },
  { name: 'Orange', hex: '#e8611a' },
  { name: 'Green',  hex: '#22c55e' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Red',    hex: '#ef4444' },
  { name: 'Teal',   hex: '#14b8a6' },
  { name: 'Pink',   hex: '#ec4899' },
  { name: 'Gold',   hex: '#eab308' }
];

function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) {}
  const oldRest = parseInt(localStorage.getItem('wm_restDefault'), 10);   // migrate pre-settings rest pref
  if (s.restDefault == null && !isNaN(oldRest)) s.restDefault = oldRest;
  window.wmSettings = { ...DEFAULT_SETTINGS, ...s };
  return window.wmSettings;
}
function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(window.wmSettings)); }
function getSetting(k) { if (!window.wmSettings) loadSettings(); return window.wmSettings[k]; }
function setSetting(k, v) { if (!window.wmSettings) loadSettings(); window.wmSettings[k] = v; saveSettings(); }

function hexToRgb(hex) {
  hex = String(hex).replace('#', '').trim();
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function accentRGBA(a) { const [r, g, b] = hexToRgb(getSetting('accent')); return `rgba(${r}, ${g}, ${b}, ${a})`; }
function applyAccent(hex) {
  const [r, g, b] = hexToRgb(hex);
  const st = document.documentElement.style;
  st.setProperty('--primary', hex);
  st.setProperty('--primary-rgb', `${r}, ${g}, ${b}`);
  const dk = 0.14;
  st.setProperty('--primary-h', `rgb(${Math.round(r*(1-dk))}, ${Math.round(g*(1-dk))}, ${Math.round(b*(1-dk))})`);
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.setAttribute('content', '#0f0f0f');
}

function wmConfirm(message, confirmLabel = 'Delete') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal active';
    overlay.innerHTML = `
      <div class="modal-overlay"></div>
      <div class="modal-card" style="max-width:360px;">
        <div class="modal-header"><span class="modal-title">Confirm</span></div>
        <div class="modal-body"><p style="color:var(--text-mid);font-size:15px;">${message}</p></div>
        <div class="modal-footer" style="flex-direction:row;justify-content:flex-end;">
          <button class="btn btn-outline btn-sm" id="_wm_cancel">Cancel</button>
          <button class="btn btn-danger btn-sm" id="_wm_confirm">${confirmLabel}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const cleanup = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector('#_wm_cancel').onclick  = () => cleanup(false);
    overlay.querySelector('#_wm_confirm').onclick = () => cleanup(true);
    overlay.querySelector('.modal-overlay').onclick = () => cleanup(false);
  });
}

function wmPrompt(title, initial = '') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal active';
    overlay.innerHTML = `
      <div class="modal-overlay"></div>
      <div class="modal-card" style="max-width:420px;">
        <div class="modal-header"><span class="modal-title">${esc(title)}</span></div>
        <div class="modal-body"><textarea class="textarea" id="_wm_prompt_input" style="min-height:80px;"></textarea></div>
        <div class="modal-footer" style="flex-direction:row;justify-content:flex-end;">
          <button class="btn btn-outline btn-sm" id="_wm_cancel">Cancel</button>
          <button class="btn btn-primary btn-sm" id="_wm_save">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#_wm_prompt_input');
    input.value = initial;
    input.focus();
    const cleanup = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector('#_wm_cancel').onclick  = () => cleanup(null);
    overlay.querySelector('#_wm_save').onclick    = () => cleanup(input.value);
    overlay.querySelector('.modal-overlay').onclick = () => cleanup(null);
  });
}

// Weight values may be numbers (new data) or strings like "135 lbs" (old data).
function parseW(v) {
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  if (!v) return 0;
  const m = String(v).match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
}
function parseR(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}
function est1RM(w, r) {
  if (w <= 0 || r <= 0) return 0;
  if (r === 1) return w;
  return w * (1 + r / 30);
}
function entryVolume(e) {
  if (!Array.isArray(e.exercises)) return 0;
  return e.exercises.reduce((tot, ex) => {
    if (!Array.isArray(ex.sets)) return tot;
    return tot + ex.sets.reduce((s, set) => s + parseW(set.weight) * parseR(set.reps), 0);
  }, 0);
}
function entrySetCount(e) {
  if (!Array.isArray(e.exercises)) return 0;
  return e.exercises.reduce((t, ex) => t + (Array.isArray(ex.sets) ? ex.sets.filter(s => parseR(s.reps) > 0).length : 0), 0);
}
function entryMuscles(e) {
  if (Array.isArray(e.muscleGroups) && e.muscleGroups.length) return e.muscleGroups;
  if (e.muscleGroup) return String(e.muscleGroup).split(',').map(s => s.trim()).filter(Boolean);
  return [];
}
function entryDate(e) {
  return e.createdAt?.seconds ? new Date(e.createdAt.seconds * 1000) : null;
}
function fmtVol(v) {
  v = Math.round(v);
  if (v >= 100000) return Math.round(v/1000) + 'k';
  if (v >= 10000)  return (v/1000).toFixed(1) + 'k';
  return v.toLocaleString();
}
function fmtDateShort(d) {
  return d ? d.toLocaleDateString('en-US', { month:'short', day:'numeric' }) : '';
}
function fmtDateLong(d) {
  return d ? d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' }) : '';
}
function autoTitle(muscles) {
  if (!muscles || muscles.length === 0) return 'Workout';
  if (muscles.length === 1) return muscles[0] === 'Full Body' ? 'Full Body Day' : muscles[0] + ' Day';
  if (muscles.length === 2) return muscles[0] + ' & ' + muscles[1];
  return muscles.slice(0, -1).join(', ') + ' & ' + muscles[muscles.length - 1];
}

const muscleGroupOptions = ['Chest','Back','Legs','Biceps','Triceps','Shoulders','Core','Full Body'];

const BUILTIN_EXERCISES = [
  'Bench Press','Incline Bench Press','Decline Bench Press','Dumbbell Bench Press','Incline Dumbbell Press',
  'Chest Fly','Cable Crossover','Push-Ups','Dips','Machine Chest Press','Pec Deck',
  'Deadlift','Barbell Row','Dumbbell Row','Pull-Ups','Chin-Ups','Lat Pulldown','Seated Cable Row',
  'T-Bar Row','Face Pull','Shrugs','Rack Pull',
  'Squat','Front Squat','Leg Press','Romanian Deadlift','Lunges','Bulgarian Split Squat','Leg Extension',
  'Leg Curl','Hip Thrust','Calf Raise','Goblet Squat','Hack Squat',
  'Overhead Press','Dumbbell Shoulder Press','Arnold Press','Lateral Raise','Front Raise','Rear Delt Fly','Upright Row',
  'Barbell Curl','Dumbbell Curl','Hammer Curl','Preacher Curl','Cable Curl','Incline Curl','Concentration Curl',
  'Close-Grip Bench Press','Skull Crushers','Tricep Pushdown','Overhead Tricep Extension','Tricep Kickback',
  'Plank','Crunches','Hanging Leg Raise','Russian Twist','Cable Crunch','Ab Wheel Rollout'
];

// ─── AUTH STATE (login system unchanged) ─────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (user) {
    window.currentUser = user;
    const snap = await getDocs(query(collection(db, 'users'), where('uid', '==', user.uid)));
    window.currentUserData = snap.empty ? {} : snap.docs[0].data();
    window.isAdmin = window.currentUserData.isAdmin === true;
    document.getElementById('nav-auth-buttons').style.display = 'none';
    document.getElementById('nav-user-info').style.display    = 'flex';
    document.getElementById('nav-username').textContent = user.displayName || user.email;
    document.getElementById('nav-admin-badge').style.display = window.isAdmin ? 'inline-block' : 'none';
    fetchMyEntries(true).then(() => { if (window.currentPage) showPage(window.currentPage); });
    loadFriendships();
  } else {
    window.currentUser = null;
    window.currentUserData = {};
    window.isAdmin = false;
    window.myEntries = null;
    window.exerciseIndex = {};
    window.friendships = [];
    document.getElementById('nav-auth-buttons').style.display = 'flex';
    document.getElementById('nav-user-info').style.display    = 'none';
  }
  if (window.currentPage) showPage(window.currentPage);
});

window.signUp = async function() {
  const username = document.getElementById('signup-username').value.trim();
  const email    = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const errorEl  = document.getElementById('signup-error');
  const btn      = document.getElementById('signup-btn');
  if (!username || !email || !password) {
    errorEl.textContent = 'Please fill in all fields.'; errorEl.classList.remove('hidden'); return;
  }
  btn.textContent = 'Creating account…'; btn.disabled = true;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: username });
    await addDoc(collection(db, 'users'), { uid: cred.user.uid, username, email, isAdmin: false, createdAt: serverTimestamp() });
    closeModal('signupModal');
    errorEl.classList.add('hidden');
    ['signup-username','signup-email','signup-password'].forEach(id => document.getElementById(id).value = '');
    toast('Welcome to WeightMate! 🎉', 'success');
  } catch (err) { errorEl.textContent = err.message; errorEl.classList.remove('hidden'); }
  btn.textContent = 'Create Account'; btn.disabled = false;
};

window.logIn = async function() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl  = document.getElementById('login-error');
  const btn      = document.getElementById('login-btn');
  if (!email || !password) { errorEl.textContent = 'Please enter your email and password.'; errorEl.classList.remove('hidden'); return; }
  btn.textContent = 'Logging in…'; btn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    closeModal('loginModal');
    errorEl.classList.add('hidden');
    ['login-email','login-password'].forEach(id => document.getElementById(id).value = '');
    toast('Welcome back!', 'success');
  } catch (err) { errorEl.textContent = 'Invalid email or password.'; errorEl.classList.remove('hidden'); }
  btn.textContent = 'Log In'; btn.disabled = false;
};

window.logOut = async function() {
  await signOut(auth);
  showPage('home');
  toast('Signed out.', 'info');
};

// ─── MY DATA CACHE + EXERCISE INDEX ──────────────────────────────────────────
window.myEntries = null;      // journal entries, newest first
window.exerciseIndex = {};    // per-exercise stats built from history

async function fetchMyEntries(force = false) {
  if (!window.currentUser) return [];
  if (window.myEntries && !force) return window.myEntries;
  let entries = [];
  try {
    const snap = await getDocs(query(
      collection(db, 'journal'),
      where('uid', '==', window.currentUser.uid),
      orderBy('createdAt', 'desc')
    ));
    entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    // Fallback if the composite index is missing: fetch unsorted and sort locally.
    const snap = await getDocs(query(collection(db, 'journal'), where('uid', '==', window.currentUser.uid)));
    entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    entries.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  }
  window.myEntries = entries;
  window.exerciseIndex = buildExerciseIndex(entries);
  return entries;
}

function buildExerciseIndex(entries) {
  const idx = {};
  // oldest → newest so "sessions" series is chronological
  [...entries].reverse().forEach(e => {
    if (!Array.isArray(e.exercises)) return;
    const d = entryDate(e);
    e.exercises.forEach(ex => {
      if (!ex.name) return;
      const sets = (Array.isArray(ex.sets) ? ex.sets : []).filter(s => parseR(s.reps) > 0);
      if (sets.length === 0) return;
      const key = ex.name.trim();
      if (!idx[key]) idx[key] = { name: key, count: 0, lastDate: null, lastSets: [], maxW: 0, maxWReps: 0, best1rm: 0, sessions: [] };
      const rec = idx[key];
      rec.count++;
      rec.lastDate = d;
      rec.lastSets = sets.map(s => ({ w: parseW(s.weight), r: parseR(s.reps) }));
      let topW = 0, topReps = 0, top1rm = 0, vol = 0;
      sets.forEach(s => {
        const w = parseW(s.weight), r = parseR(s.reps);
        vol += w * r;
        if (w > topW) { topW = w; topReps = r; }
        else if (w === topW && r > topReps) topReps = r;
        const rm = est1RM(w, r);
        if (rm > top1rm) top1rm = rm;
      });
      if (topW > rec.maxW || (topW === rec.maxW && topReps > rec.maxWReps)) { rec.maxW = topW; rec.maxWReps = topReps; }
      if (top1rm > rec.best1rm) rec.best1rm = top1rm;
      rec.sessions.push({ date: d, topW, topReps, e1rm: top1rm, vol, sets: sets.length });
    });
  });
  return idx;
}

function lastSetsLabel(rec) {
  if (!rec || !rec.lastSets.length) return '';
  const parts = rec.lastSets.slice(0, 4).map(s => `${s.w % 1 ? s.w : Math.round(s.w)}×${s.r}`);
  const more = rec.lastSets.length > 4 ? '…' : '';
  return `${parts.join(', ')}${more}`;
}

// ─── ACTIVE SESSION (the new logging flow) ───────────────────────────────────
const SESSION_KEY = 'wm_activeSession';

function getSession() {
  if (window.activeSession !== undefined) return window.activeSession;
  try { window.activeSession = JSON.parse(localStorage.getItem(SESSION_KEY)); }
  catch (e) { window.activeSession = null; }
  return window.activeSession;
}
function persistSession() {
  if (window.activeSession) localStorage.setItem(SESSION_KEY, JSON.stringify(window.activeSession));
  else localStorage.removeItem(SESSION_KEY);
  updateFab();
}
function getRestDefault() { return getSetting('restDefault'); }

function startSession(prefill) {
  window.activeSession = {
    startedAt: Date.now(),
    muscles: prefill?.muscles || [],
    exercises: prefill?.exercises || [],
    notes: ''
  };
  persistSession();
  showPage('session');
}

window.tapFab = function() {
  if (!window.currentUser) { openModal('loginModal'); return; }
  if (getSession()) { showPage('session'); return; }
  startSession();
};

window.startEmptySession = function() {
  if (!window.currentUser) { openModal('loginModal'); return; }
  if (getSession()) { showPage('session'); return; }
  startSession();
};

// Start a session pre-filled from a past entry ("Repeat")
window.repeatEntry = async function(entryId) {
  if (!window.currentUser) { openModal('loginModal'); return; }
  if (getSession()) {
    if (!await wmConfirm('You already have a workout in progress. Discard it and start fresh?', 'Discard & Start')) return;
  }
  const e = (window.myEntries || []).find(x => x.id === entryId);
  if (!e) return;
  const exercises = (Array.isArray(e.exercises) ? e.exercises : []).map(ex => ({
    name: ex.name,
    sets: (Array.isArray(ex.sets) ? ex.sets : []).map(s => ({ weight: parseW(s.weight), reps: parseR(s.reps), done: false }))
  }));
  startSession({ muscles: entryMuscles(e), exercises });
  toast('Repeating "' + esc(e.workoutTitle || 'workout') + '" — go crush it 💪', 'info');
};

function updateFab() {
  const fab = document.getElementById('fab-btn');
  if (!fab) return;
  if (getSession() && window.currentPage !== 'session') { fab.textContent = '▶'; fab.classList.add('fab-live'); }
  else { fab.textContent = '+'; fab.classList.remove('fab-live'); }
}

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
}

function sessionLiveStats() {
  const s = getSession();
  if (!s) return { vol: 0, sets: 0, done: 0 };
  let vol = 0, sets = 0, done = 0;
  s.exercises.forEach(ex => ex.sets.forEach(set => {
    if (parseR(set.reps) > 0) {
      sets++;
      vol += parseW(set.weight) * parseR(set.reps);
      if (set.done) done++;
    }
  }));
  return { vol, sets, done };
}

function updateSessionStatsBar() {
  const el = document.getElementById('session-stats');
  if (!el) return;
  const { vol, sets, done } = sessionLiveStats();
  el.innerHTML = `<span><strong>${done}</strong>/${sets} sets</span><span class="ss-dot">·</span><span><strong>${fmtVol(vol)}</strong> lbs volume</span>`;
}

function sessionPage() {
  const s = getSession();
  if (!s) { setTimeout(() => showPage('home'), 0); return '<div class="spinner"></div>'; }
  setTimeout(() => {
    renderSession();
    startElapsedTicker();
  }, 0);
  return `
    <div class="session-wrap container-sm">
      <div class="session-header">
        <div>
          <p class="session-live-label"><span class="live-dot"></span> LIVE WORKOUT</p>
          <p class="session-elapsed" id="session-elapsed">0:00</p>
          <div class="session-stats" id="session-stats"></div>
        </div>
        <div class="session-header-btns">
          <button class="btn btn-ghost btn-sm text-danger" onclick="cancelSession()">Discard</button>
          <button class="btn btn-primary" onclick="openFinishSheet()">Finish</button>
        </div>
      </div>
      <div id="session-body"></div>
    </div>`;
}

function startElapsedTicker() {
  stopElapsedTicker();
  window._elapsedTicker = setInterval(() => {
    const el = document.getElementById('session-elapsed');
    const s = getSession();
    if (!el || !s) { stopElapsedTicker(); return; }
    el.textContent = fmtElapsed(Date.now() - s.startedAt);
  }, 1000);
  const el = document.getElementById('session-elapsed');
  const s = getSession();
  if (el && s) el.textContent = fmtElapsed(Date.now() - s.startedAt);
}
function stopElapsedTicker() {
  if (window._elapsedTicker) { clearInterval(window._elapsedTicker); window._elapsedTicker = null; }
}

// Full structural render of the session body (add/remove exercise/set, chips).
function renderSession() {
  const s = getSession();
  const body = document.getElementById('session-body');
  if (!s || !body) return;
  const rest = getRestDefault();

  const chipsHtml = muscleGroupOptions.map(m => `
    <button class="chip ${s.muscles.includes(m) ? 'chip-on' : ''}" onclick="toggleMuscle('${m}')">${m}</button>
  `).join('');

  const restOpts = [0, 60, 90, 120, 180];
  const restHtml = restOpts.map(r => `
    <button class="chip chip-sm ${rest === r ? 'chip-on' : ''}" onclick="setRestDefault(${r})">${r === 0 ? 'Off' : r < 120 ? r + 's' : (r/60) + 'm'}</button>
  `).join('');

  const exHtml = s.exercises.map((ex, ei) => {
    const rec = window.exerciseIndex[ex.name.trim()];
    const hints = [];
    if (rec && rec.lastSets.length) hints.push(`Last: ${lastSetsLabel(rec)}`);
    if (rec && rec.maxW > 0) hints.push(`Best: ${rec.maxW % 1 ? rec.maxW : Math.round(rec.maxW)}×${rec.maxWReps}`);
    const setsHtml = ex.sets.map((set, si) => setRowHtml(ei, si, set)).join('');
    return `
      <div class="ex-card">
        <div class="ex-card-head">
          <div class="flex-grow">
            <p class="ex-card-name">${esc(ex.name)}</p>
            ${hints.length ? `<p class="ex-card-hint">${esc(hints.join('  ·  '))}</p>` : ''}
          </div>
          <button class="btn btn-ghost btn-sm text-danger" onclick="removeExercise(${ei})" aria-label="Remove exercise">&times;</button>
        </div>
        <div class="ss-header"><span>Set</span><span>lbs</span><span>Reps</span><span></span></div>
        ${setsHtml}
        <div class="flex gap-2 mt-2">
          <button class="btn btn-outline btn-sm flex-grow" onclick="addSet(${ei})">+ Add Set</button>
          ${ex.sets.length > 1 ? `<button class="btn btn-ghost btn-sm" onclick="removeLastSet(${ei})">− Remove Set</button>` : ''}
        </div>
      </div>`;
  }).join('');

  body.innerHTML = `
    <div class="session-section">
      <p class="session-section-label">Muscle groups <span class="text-muted" style="font-weight:400;text-transform:none;">(tap all that apply)</span></p>
      <div class="chip-row">${chipsHtml}</div>
    </div>
    <div class="session-section">
      <p class="session-section-label">Auto rest timer</p>
      <div class="chip-row">${restHtml}</div>
    </div>
    ${exHtml}
    <button class="btn btn-primary btn-lg w-full mt-2" onclick="openExercisePicker()">+ Add Exercise</button>
    <div class="field mt-5">
      <label class="label">Notes (optional)</label>
      <textarea class="textarea" id="session-notes" placeholder="How did it feel?" style="min-height:64px;" oninput="sessionNotesInput(this.value)">${esc(s.notes)}</textarea>
    </div>
    <div style="height:24px;"></div>`;
  updateSessionStatsBar();
}

function setRowHtml(ei, si, set) {
  const w = set.weight === 0 || set.weight ? set.weight : '';
  const r = set.reps === 0 || set.reps ? set.reps : '';
  return `
    <div class="ss-row ${set.done ? 'ss-done-row' : ''}" id="ss-${ei}-${si}">
      <span class="ss-num">${si + 1}</span>
      <div class="ss-ctl">
        <button class="ss-step" onclick="stepWeight(${ei},${si},-1)">−</button>
        <input class="ss-in" type="number" inputmode="decimal" step="2.5" value="${w}" placeholder="0"
               oninput="setSetField(${ei},${si},'weight',this.value)" />
        <button class="ss-step" onclick="stepWeight(${ei},${si},1)">+</button>
      </div>
      <div class="ss-ctl">
        <button class="ss-step" onclick="stepSet(${ei},${si},'reps',-1)">−</button>
        <input class="ss-in" type="number" inputmode="numeric" value="${r}" placeholder="0"
               oninput="setSetField(${ei},${si},'reps',this.value)" />
        <button class="ss-step" onclick="stepSet(${ei},${si},'reps',1)">+</button>
      </div>
      <button class="ss-check ${set.done ? 'on' : ''}" onclick="toggleSetDone(${ei},${si})">✓</button>
    </div>`;
}

window.toggleMuscle = function(m) {
  const s = getSession(); if (!s) return;
  const i = s.muscles.indexOf(m);
  if (i >= 0) s.muscles.splice(i, 1); else s.muscles.push(m);
  persistSession();
  renderSession();
};

window.setRestDefault = function(sec) {
  setSetting('restDefault', sec);
  renderSession();
};

window.sessionNotesInput = function(v) {
  const s = getSession(); if (!s) return;
  s.notes = v;
  persistSession();
};

window.setSetField = function(ei, si, field, v) {
  const s = getSession(); if (!s) return;
  const set = s.exercises[ei]?.sets[si]; if (!set) return;
  set[field] = v === '' ? '' : parseFloat(v);
  persistSession();
  updateSessionStatsBar();
};

window.stepSet = function(ei, si, field, delta) {
  const s = getSession(); if (!s) return;
  const set = s.exercises[ei]?.sets[si]; if (!set) return;
  const cur = parseFloat(set[field]) || 0;
  const next = Math.max(0, cur + delta);
  set[field] = next;
  const row = document.getElementById(`ss-${ei}-${si}`);
  if (row) {
    const input = row.querySelectorAll('.ss-in')[field === 'weight' ? 0 : 1];
    if (input) input.value = next;
  }
  persistSession();
  updateSessionStatsBar();
};

// Weight stepper uses the increment from Settings (default 5).
window.stepWeight = function(ei, si, dir) {
  stepSet(ei, si, 'weight', dir * getSetting('weightStep'));
};

function haptic(pattern) {
  if (getSetting('haptics') && 'vibrate' in navigator) navigator.vibrate(pattern);
}

window.toggleSetDone = function(ei, si) {
  const s = getSession(); if (!s) return;
  const set = s.exercises[ei]?.sets[si]; if (!set) return;
  set.done = !set.done;
  const row = document.getElementById(`ss-${ei}-${si}`);
  if (row) {
    row.classList.toggle('ss-done-row', set.done);
    row.querySelector('.ss-check')?.classList.toggle('on', set.done);
  }
  persistSession();
  updateSessionStatsBar();
  if (set.done) {
    const rest = getRestDefault();
    if (getSetting('autoRest') && rest > 0) startRestTimer(rest);
    haptic(30);
  }
};

window.addSet = function(ei) {
  const s = getSession(); if (!s) return;
  const ex = s.exercises[ei]; if (!ex) return;
  const prev = ex.sets[ex.sets.length - 1];
  ex.sets.push({ weight: prev ? prev.weight : '', reps: prev ? prev.reps : '', done: false });
  persistSession();
  renderSession();
};

window.removeLastSet = function(ei) {
  const s = getSession(); if (!s) return;
  const ex = s.exercises[ei]; if (!ex || ex.sets.length <= 1) return;
  ex.sets.pop();
  persistSession();
  renderSession();
};

window.removeExercise = async function(ei) {
  const s = getSession(); if (!s) return;
  const ex = s.exercises[ei]; if (!ex) return;
  const hasData = ex.sets.some(set => parseR(set.reps) > 0);
  if (hasData && !await wmConfirm(`Remove <strong>${esc(ex.name)}</strong> and its sets from this workout?`, 'Remove')) return;
  s.exercises.splice(ei, 1);
  persistSession();
  renderSession();
};

// ── Exercise picker sheet
window.openExercisePicker = function() {
  document.getElementById('ex-search').value = '';
  openSheet('exercisePickerSheet');
  renderExercisePicker();
  // don't auto-focus on mobile: keyboard covers the list. User taps to type.
};

window.renderExercisePicker = function() {
  const term = document.getElementById('ex-search').value.trim().toLowerCase();
  const container = document.getElementById('ex-picker-results');
  const s = getSession();
  const inSession = new Set((s?.exercises || []).map(e => e.name.trim().toLowerCase()));

  // My history first (sorted: most used), then built-ins not already in history.
  const hist = Object.values(window.exerciseIndex || {}).sort((a, b) => b.count - a.count);
  const histNames = new Set(hist.map(h => h.name.toLowerCase()));
  const builtins = BUILTIN_EXERCISES.filter(n => !histNames.has(n.toLowerCase()));

  let results = [
    ...hist.map(h => ({ name: h.name, meta: `${h.count}× logged · best ${h.maxW % 1 ? h.maxW : Math.round(h.maxW)} lbs`, mine: true })),
    ...builtins.map(n => ({ name: n, meta: '', mine: false }))
  ];
  if (term) results = results.filter(r => r.name.toLowerCase().includes(term));
  results = results.filter(r => !inSession.has(r.name.trim().toLowerCase()));
  results = results.slice(0, 40);

  window._pickerResults = results.map(r => r.name);

  let html = '';
  const typed = document.getElementById('ex-search').value.trim();
  if (typed && !results.some(r => r.name.toLowerCase() === term)) {
    html += `<button class="picker-row picker-new" onclick="pickTypedExercise()">＋ Add “${esc(typed)}”</button>`;
  }
  html += results.map((r, i) => `
    <button class="picker-row" onclick="pickExercise(${i})">
      <span class="picker-name">${r.mine ? '⭐ ' : ''}${esc(r.name)}</span>
      ${r.meta ? `<span class="picker-meta">${esc(r.meta)}</span>` : ''}
    </button>`).join('');
  if (!html) html = '<p class="text-sm text-muted" style="padding:16px;">Type a name to add a new exercise.</p>';
  container.innerHTML = html;
};

window.pickExercise = function(i) {
  addExerciseToSession(window._pickerResults[i]);
};
window.pickTypedExercise = function() {
  const name = document.getElementById('ex-search').value.trim();
  if (name) addExerciseToSession(name);
};

function addExerciseToSession(name) {
  const s = getSession(); if (!s) return;
  const rec = window.exerciseIndex[name.trim()];
  // Prefill first set from your last session of this exercise
  const first = rec && rec.lastSets.length
    ? { weight: rec.lastSets[0].w, reps: rec.lastSets[0].r, done: false }
    : { weight: '', reps: '', done: false };
  s.exercises.push({ name: name.trim(), sets: [first] });
  persistSession();
  closeSheet('exercisePickerSheet');
  renderSession();
  setTimeout(() => {
    const cards = document.querySelectorAll('.ex-card');
    cards[cards.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 60);
}

// ── Finish + save
function cleanSessionExercises(s) {
  return s.exercises
    .map(ex => ({
      name: ex.name.trim(),
      sets: ex.sets
        .filter(set => parseR(set.reps) > 0)
        .map((set, i) => ({ setNum: i + 1, reps: parseR(set.reps), weight: parseW(set.weight), unit: 'lbs', done: !!set.done }))
    }))
    .filter(ex => ex.name && ex.sets.length > 0);
}

function computeSessionPRs(exercises) {
  const prs = [];
  exercises.forEach(ex => {
    const rec = window.exerciseIndex[ex.name];
    let topW = 0, topReps = 0, top1rm = 0;
    ex.sets.forEach(set => {
      if (set.weight > topW) { topW = set.weight; topReps = set.reps; }
      else if (set.weight === topW && set.reps > topReps) topReps = set.reps;
      const rm = est1RM(set.weight, set.reps);
      if (rm > top1rm) top1rm = rm;
    });
    if (topW <= 0) return;
    const isWeightPR = !rec || topW > rec.maxW;
    const is1rmPR    = !rec || top1rm > rec.best1rm;
    if ((isWeightPR || is1rmPR) && rec) {  // only count PRs vs actual history
      prs.push({ exercise: ex.name, weight: topW, reps: topReps, e1rm: Math.round(top1rm) });
    }
  });
  return prs;
}

window.openFinishSheet = function() {
  const s = getSession(); if (!s) return;
  const exercises = cleanSessionExercises(s);
  if (exercises.length === 0) { toast('Log at least one set first (enter reps).', 'warning'); return; }
  if (s.muscles.length === 0) { toast('Tap at least one muscle group — future-you wants that data. 📊', 'warning'); return; }

  const vol = exercises.reduce((t, ex) => t + ex.sets.reduce((v, set) => v + set.weight * set.reps, 0), 0);
  const sets = exercises.reduce((t, ex) => t + ex.sets.length, 0);
  const mins = Math.max(1, Math.round((Date.now() - s.startedAt) / 60000));
  const prs = computeSessionPRs(exercises);
  window._pendingSave = { exercises, vol, sets, mins, prs };

  document.getElementById('finish-summary').innerHTML = `
    <div class="field">
      <label class="label">Workout name</label>
      <input class="input" type="text" id="finish-title" value="${esc(autoTitle(s.muscles))}" />
    </div>
    <div class="finish-grid">
      <div class="finish-cell"><div class="finish-num">${mins}</div><div class="finish-lbl">minutes</div></div>
      <div class="finish-cell"><div class="finish-num">${exercises.length}</div><div class="finish-lbl">exercises</div></div>
      <div class="finish-cell"><div class="finish-num">${sets}</div><div class="finish-lbl">sets</div></div>
      <div class="finish-cell"><div class="finish-num">${fmtVol(vol)}</div><div class="finish-lbl">lbs volume</div></div>
    </div>
    ${prs.length ? `
      <div class="pr-callout">
        ${prs.map(p => `<div>🏆 <strong>New PR:</strong> ${esc(p.exercise)} — ${p.weight % 1 ? p.weight : Math.round(p.weight)}×${p.reps}</div>`).join('')}
      </div>` : ''}
    <p class="text-xs text-muted mt-2">${esc(s.muscles.join(' · '))}</p>`;
  openSheet('finishSheet');
};

window.saveSession = async function() {
  const s = getSession();
  const pending = window._pendingSave;
  if (!s || !pending || !window.currentUser) return;
  const btn = document.getElementById('finish-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const title = document.getElementById('finish-title')?.value.trim() || autoTitle(s.muscles);
  try {
    await addDoc(collection(db, 'journal'), {
      uid: window.currentUser.uid,
      username: window.currentUser.displayName || window.currentUser.email,
      workoutTitle: title,
      muscleGroup: s.muscles.join(', '),   // legacy-compatible field
      muscleGroups: s.muscles,
      exercises: pending.exercises,
      notes: s.notes.trim(),
      startedAt: s.startedAt,
      durationMin: pending.mins,
      totalVolume: Math.round(pending.vol),
      totalSets: pending.sets,
      prs: pending.prs,
      source: 'live',
      createdAt: serverTimestamp()
    });
    window.activeSession = null;
    persistSession();
    cancelRestTimer();
    stopElapsedTicker();
    closeSheet('finishSheet');
    await fetchMyEntries(true);
    showPage('history');
    toast(pending.prs.length
      ? `Saved! ${pending.prs.length} new PR${pending.prs.length > 1 ? 's' : ''} 🏆`
      : 'Workout saved! 💪', pending.prs.length ? 'pr' : 'success', 4200);
  } catch (err) {
    console.error(err);
    toast('Error saving workout — it\'s still safe on this device. Try again.', 'error');
  }
  btn.disabled = false; btn.textContent = 'Save Workout ✓';
};

window.cancelSession = async function() {
  const s = getSession(); if (!s) return;
  const hasData = s.exercises.some(ex => ex.sets.some(set => parseR(set.reps) > 0));
  if (hasData && !await wmConfirm('Discard this workout? All logged sets will be lost.', 'Discard')) return;
  window.activeSession = null;
  persistSession();
  cancelRestTimer();
  stopElapsedTicker();
  showPage('home');
};

// ─── HOME PAGE ────────────────────────────────────────────────────────────────
function homePage() {
  if (!window.currentUser) {
    return `
      <section class="hero-section">
        <div class="container hero-inner">
          <h1 class="hero-title">Log fast.<br /><em>Lift heavy.</em></h1>
          <p class="hero-sub">WeightMate is your personal lifting tracker. Start a live workout, log sets in two taps, and watch your strength climb — with your friends along for the ride.</p>
          <div class="hero-actions">
            <a class="btn btn-primary btn-lg" onclick="openModal('signupModal')">Create Account</a>
            <a class="btn btn-outline btn-lg" onclick="openModal('loginModal')">Log In</a>
          </div>
          <div class="hero-stats">
            <div class="stat-item"><div class="stat-num">⚡</div><div class="stat-label">2-tap set logging</div></div>
            <div class="stat-item"><div class="stat-num">📈</div><div class="stat-label">Every lift charted</div></div>
            <div class="stat-item"><div class="stat-num">👥</div><div class="stat-label">Train with friends</div></div>
          </div>
        </div>
      </section>`;
  }
  setTimeout(renderHomeDashboard, 0);
  return `<div class="container-sm section-tight" id="home-dash"><div class="spinner"></div></div>`;
}

async function renderHomeDashboard() {
  const el = document.getElementById('home-dash');
  if (!el) return;
  const entries = await fetchMyEntries();
  if (!document.getElementById('home-dash')) return; // navigated away

  const name = (window.currentUser.displayName || 'lifter').split(' ')[0];
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';

  const now = Date.now(), weekMs = 7 * 86400000;
  const week = entries.filter(e => entryDate(e) && now - entryDate(e).getTime() < weekMs);
  const weekVol = week.reduce((t, e) => t + entryVolume(e), 0);
  const weekSets = week.reduce((t, e) => t + entrySetCount(e), 0);
  const streak = computeStreak(entries);

  const active = getSession();
  const last = entries[0];

  // recent PRs from saved sessions
  const recentPRs = [];
  for (const e of entries) {
    if (Array.isArray(e.prs)) e.prs.forEach(p => { if (recentPRs.length < 3) recentPRs.push({ ...p, date: entryDate(e) }); });
    if (recentPRs.length >= 3) break;
  }

  el.innerHTML = `
    <p class="dash-greet">${greet}, <strong>${esc(name)}</strong> 👋</p>
    <p class="text-sm text-muted mb-4">${new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' })}</p>

    ${active ? `
      <div class="resume-banner" onclick="showPage('session')">
        <div><span class="live-dot"></span> <strong>Workout in progress</strong> — ${fmtElapsed(Date.now() - active.startedAt)}</div>
        <span class="btn btn-primary btn-sm">Resume ▶</span>
      </div>` : `
      <button class="btn btn-primary btn-lg w-full start-btn" onclick="startEmptySession()">🏋 Start Workout</button>
      ${last ? `<button class="btn btn-outline w-full mt-2" onclick="repeatEntry('${last.id}')">↻ Repeat: ${esc(last.workoutTitle || 'Last workout')}</button>` : ''}`}

    <div class="journal-stats mt-5">
      <div class="stat-card"><div class="stat-card-num">${week.length}</div><div class="stat-card-label">Workouts / 7d</div></div>
      <div class="stat-card"><div class="stat-card-num">${streak}</div><div class="stat-card-label">Day Streak 🔥</div></div>
      <div class="stat-card"><div class="stat-card-num">${weekSets}</div><div class="stat-card-label">Sets / 7d</div></div>
      <div class="stat-card"><div class="stat-card-num" style="font-size:22px;">${fmtVol(weekVol)}</div><div class="stat-card-label">Volume / 7d</div></div>
    </div>

    ${recentPRs.length ? `
      <div class="box mb-4">
        <div class="j-section-head"><p class="j-section-title">🏆 Recent PRs</p><a class="text-xs" onclick="showPage('progress')">See progress →</a></div>
        ${recentPRs.map(p => `
          <div class="pr-row">
            <span class="font-bold text-white">${esc(p.exercise)}</span>
            <span class="text-orange font-bold">${p.weight % 1 ? p.weight : Math.round(p.weight)}×${p.reps}</span>
            <span class="text-xs text-muted">${fmtDateShort(p.date)}</span>
          </div>`).join('')}
      </div>` : ''}

    <div class="box mb-4" id="home-friends-box">
      <div class="j-section-head"><p class="j-section-title">👥 Friends</p><a class="text-xs" onclick="showPage('friends')">See all →</a></div>
      <div id="home-friends-feed"><div class="spinner spinner-sm"></div></div>
    </div>`;

  fillHomeFriendsFeed();
}

async function fillHomeFriendsFeed() {
  const el = document.getElementById('home-friends-feed');
  if (!el) return;
  try {
    const friends = await getAcceptedFriends();
    if (friends.length === 0) {
      el.innerHTML = `<p class="text-sm text-muted">No friends yet. <a onclick="showPage('friends')">Add your gym buddies</a> to see their workouts here.</p>`;
      return;
    }
    const feed = await fetchFriendsFeed(friends, 3);
    if (!document.getElementById('home-friends-feed')) return;
    if (feed.length === 0) { el.innerHTML = '<p class="text-sm text-muted">Your friends haven\'t logged anything yet. Set the pace. 😤</p>'; return; }
    el.innerHTML = feed.slice(0, 3).map(f => `
      <div class="pr-row">
        <span class="font-bold text-white">${esc(f.username)}</span>
        <span class="text-mid text-sm">${esc(f.entry.workoutTitle || 'Workout')}</span>
        <span class="text-xs text-muted">${fmtDateShort(entryDate(f.entry))}</span>
      </div>`).join('');
  } catch (err) { el.innerHTML = '<p class="text-sm text-muted">Couldn\'t load friend activity.</p>'; }
}

function computeStreak(entries) {
  const uniqueDays = [...new Set(
    entries.filter(e => entryDate(e)).map(e => entryDate(e).toDateString())
  )].map(s => new Date(s)).sort((a, b) => b - a);
  let streak = 0;
  let cursor = new Date(); cursor.setHours(0,0,0,0);
  for (const d of uniqueDays) {
    const dd = new Date(d); dd.setHours(0,0,0,0);
    const diffDays = Math.round((cursor - dd) / 86400000);
    if (diffDays <= 1) { streak++; cursor = dd; } else break;
  }
  return streak;
}

// ─── HISTORY PAGE (calendar kept!) ───────────────────────────────────────────
function historyPage() {
  if (!window.currentUser) return loginPrompt('your training history');
  setTimeout(renderHistory, 0);
  return `
    <div class="page-header"><div class="container-sm"><h1>History</h1><p>Every session you've logged.</p></div></div>
    <section class="section-tight"><div class="container-sm" id="history-container"><div class="spinner"></div></div></section>`;
}

async function renderHistory() {
  const container = document.getElementById('history-container');
  if (!container) return;
  const entries = await fetchMyEntries();
  if (!document.getElementById('history-container')) return;
  window.cachedJournalEntries = entries;

  const calendarHtml = `
    <div class="cal-section">
      <div id="monthly-calendar">${renderMonthlyCalendar(entries, window.calMonth, window.calYear)}</div>
      <p class="text-xs text-muted mt-3" style="text-align:center;">Tap a highlighted day to view that day's workouts.</p>
    </div>
    <div class="heatmap-section">
      <div class="j-section-head">
        <p class="j-section-title">📊 Last 12 weeks</p>
      </div>
      <div class="heatmap-wrap"><div class="heatmap">${renderHeatmap(entries)}</div></div>
      <div class="heatmap-legend">
        <span class="text-xs text-muted mr-1">Less</span>
        <div class="heatmap-day level-0"></div><div class="heatmap-day level-1"></div>
        <div class="heatmap-day level-2"></div><div class="heatmap-day level-3"></div>
        <span class="text-xs text-muted ml-1">More</span>
      </div>
    </div>`;

  let listHtml = `<div class="j-section-head mt-5"><p class="j-section-title">📝 Sessions</p><p class="text-xs text-muted">${entries.length} total</p></div>`;
  if (entries.length === 0) {
    listHtml += `<div class="empty-state"><div class="empty-state-icon">🏋</div><h3>Nothing logged yet</h3><p>Tap the + button and start your first workout.</p></div>`;
  } else {
    listHtml += entries.map(e => entryCardHtml(e, { mine: true })).join('');
  }
  container.innerHTML = calendarHtml + listHtml;
}

function entryCardHtml(e, opts = {}) {
  const d = entryDate(e);
  const muscles = entryMuscles(e);
  const vol = e.totalVolume ?? Math.round(entryVolume(e));
  const sets = e.totalSets ?? entrySetCount(e);
  const prCount = Array.isArray(e.prs) ? e.prs.length : 0;
  const exNames = (Array.isArray(e.exercises) ? e.exercises : []).map(ex => ex.name).filter(Boolean);
  const domId = `entry-${e.id}`;
  return `
    <div class="box entry-card mb-3" id="${domId}">
      <div class="entry-tap" onclick="document.getElementById('${domId}').classList.toggle('open')">
        <div class="flex items-center gap-2 flex-wrap mb-1">
          ${opts.username ? `<span class="avatar avatar-sm">${esc((opts.username || '?')[0])}</span>` : ''}
          <h3 class="font-bold text-white" style="font-size:16px;">${esc(e.workoutTitle || 'Workout')}</h3>
          ${prCount ? `<span class="badge badge-green">🏆 ${prCount} PR${prCount > 1 ? 's' : ''}</span>` : ''}
        </div>
        ${opts.username ? `<p class="text-xs text-orange font-bold mb-1">${esc(opts.username)}</p>` : ''}
        <div class="workout-meta">
          <span>📅 ${fmtDateLong(d)}</span>
          ${e.durationMin ? `<span>⏱ ${e.durationMin} min</span>` : ''}
          ${vol > 0 ? `<span>🏋 ${fmtVol(vol)} lbs</span>` : ''}
          ${sets > 0 ? `<span>${sets} sets</span>` : ''}
        </div>
        <div class="flex gap-1 flex-wrap mt-2">
          ${muscles.map(m => `<span class="badge badge-orange">${esc(m)}</span>`).join('')}
        </div>
        ${exNames.length ? `<p class="text-xs text-muted mt-2 entry-exlist">${esc(exNames.join(' · '))}</p>` : ''}
      </div>
      <div class="entry-detail">
        ${entryDetailHtml(e)}
        ${e.notes ? `<div class="notes-block mt-3">📝 ${esc(e.notes)}</div>` : ''}
        ${opts.mine ? `
          <div class="flex gap-2 mt-3 flex-wrap">
            <button class="btn btn-outline btn-sm" onclick="repeatEntry('${e.id}')">↻ Repeat</button>
            <button class="btn btn-ghost btn-sm text-orange" onclick="editEntryNotes('${e.id}')">Edit Notes</button>
            <button class="btn btn-ghost btn-sm text-danger" onclick="deleteEntry('${e.id}')">Delete</button>
          </div>` : ''}
      </div>
    </div>`;
}

function entryDetailHtml(e) {
  if (!Array.isArray(e.exercises) || e.exercises.length === 0) return '<p class="text-sm text-muted">No exercises recorded.</p>';
  return e.exercises.map(ex => {
    const sets = Array.isArray(ex.sets) ? ex.sets : [];
    const prNames = new Set((e.prs || []).map(p => p.exercise));
    const setsStr = sets.map(s => {
      const w = parseW(s.weight), r = parseR(s.reps);
      return w > 0 ? `${w % 1 ? w : Math.round(w)}×${r}` : `${r} reps`;
    }).join('  ·  ');
    return `<div class="entry-ex-row">
      <span class="font-bold text-white text-sm">${esc(ex.name)}${prNames.has(ex.name) ? ' 🏆' : ''}</span>
      <span class="text-sm text-mid">${setsStr}</span>
    </div>`;
  }).join('');
}

window.editEntryNotes = async function(id) {
  const e = (window.myEntries || []).find(x => x.id === id);
  if (!e) return;
  const notes = await wmPrompt('Edit Notes', e.notes || '');
  if (notes === null) return;
  try {
    await updateDoc(doc(db, 'journal', id), { notes });
    e.notes = notes;
    toast('Notes updated!', 'success');
    showPage(window.currentPage);
  } catch (err) { toast('Error updating notes.', 'error'); }
};

window.deleteEntry = async function(id) {
  if (!await wmConfirm('Delete this workout? This cannot be undone.')) return;
  try {
    await deleteDoc(doc(db, 'journal', id));
    await fetchMyEntries(true);
    showPage(window.currentPage);
    toast('Workout deleted.', 'info');
  } catch (err) { toast('Error deleting.', 'error'); }
};

// ─── PROGRESS PAGE (the data hub) ────────────────────────────────────────────
function progressPage() {
  if (!window.currentUser) return loginPrompt('your lift analytics');
  setTimeout(renderProgress, 0);
  return `
    <div class="page-header"><div class="container-sm"><h1>Progress</h1><p>Every pound, charted.</p></div></div>
    <section class="section-tight"><div class="container-sm" id="progress-container"><div class="spinner"></div></div></section>`;
}

async function renderProgress() {
  const container = document.getElementById('progress-container');
  if (!container) return;
  const entries = await fetchMyEntries();
  if (!document.getElementById('progress-container')) return;

  const idx = window.exerciseIndex;
  const exNames = Object.values(idx).sort((a, b) => b.count - a.count).map(r => r.name);

  // body weight
  let weightEntries = [];
  try {
    const wSnap = await getDocs(query(collection(db, 'bodyWeight'), where('uid', '==', window.currentUser.uid)));
    weightEntries = wSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {}

  const exSection = exNames.length === 0
    ? `<div class="box mb-4"><div class="j-section-head"><p class="j-section-title">📈 Exercise Progression</p></div>
       <p class="text-sm text-muted">Log a few workouts and your lift charts will appear here.</p></div>`
    : `<div class="box mb-4">
        <div class="j-section-head"><p class="j-section-title">📈 Exercise Progression</p></div>
        <div class="select-wrap mb-3">
          <select id="progress-ex-select" onchange="renderExerciseAnalytics(this.value)">
            ${exNames.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}
          </select>
        </div>
        <div id="exercise-analytics"></div>
      </div>`;

  const bests = Object.values(idx).filter(r => r.maxW > 0).sort((a, b) => b.maxW - a.maxW);
  const pbHtml = bests.length ? `
    <div class="box mb-4">
      <div class="j-section-head"><p class="j-section-title">🏆 Personal Bests</p><p class="text-xs text-muted">heaviest set per exercise</p></div>
      <div class="pb-grid">
        ${bests.slice(0, 8).map(r => `
          <div class="pb-item">
            <div class="pb-exercise">${esc(r.name)}</div>
            <div class="pb-weight">${r.maxW % 1 ? r.maxW : Math.round(r.maxW)} <span style="font-size:12px;">lbs</span></div>
            <div class="pb-reps">× ${r.maxWReps} reps · est 1RM ${Math.round(r.best1rm)}</div>
          </div>`).join('')}
      </div>
    </div>` : '';

  container.innerHTML = `
    ${exSection}
    <div class="box mb-4">
      <div class="j-section-head"><p class="j-section-title">📊 Weekly Volume</p><p class="text-xs text-muted">last 8 weeks · lbs lifted</p></div>
      ${renderWeeklyVolumeChart(entries)}
    </div>
    <div class="box mb-4">
      <div class="j-section-head"><p class="j-section-title">🎯 Muscle Balance</p><p class="text-xs text-muted">sets · last 30 days</p></div>
      ${renderMuscleSplit(entries)}
    </div>
    ${pbHtml}
    ${renderBodyWeightSection(weightEntries)}
    ${render1RMSection()}`;

  if (exNames.length) renderExerciseAnalytics(exNames[0]);
}

window.renderExerciseAnalytics = function(name) {
  const el = document.getElementById('exercise-analytics');
  const rec = window.exerciseIndex[name];
  if (!el || !rec) return;

  const sess = rec.sessions.slice(-15);
  const topW = sess.map(s => s.topW);
  const e1rm = sess.map(s => Math.round(s.e1rm));
  const labels = sess.map(s => fmtDateShort(s.date));
  const totalVol = rec.sessions.reduce((t, s) => t + s.vol, 0);

  const chart = sess.length >= 2
    ? svgLineChart([
        { vals: e1rm, color: accentRGBA(0.45), dash: '4 3' },
        { vals: topW, color: 'var(--primary)' }
      ], labels)
    : `<p class="text-sm text-muted" style="text-align:center;padding:14px;">Log this exercise twice to unlock the chart.</p>`;

  const histRows = rec.sessions.slice(-6).reverse().map(s => `
    <tr>
      <td class="text-muted">${fmtDateShort(s.date)}</td>
      <td class="font-bold" style="color:var(--text);">${s.topW % 1 ? s.topW : Math.round(s.topW)}×${s.topReps}</td>
      <td>${s.sets}</td>
      <td>${fmtVol(s.vol)}</td>
    </tr>`).join('');

  el.innerHTML = `
    <div class="ex-stat-tiles">
      <div class="finish-cell"><div class="finish-num">${rec.maxW % 1 ? rec.maxW : Math.round(rec.maxW)}</div><div class="finish-lbl">best set (lbs)</div></div>
      <div class="finish-cell"><div class="finish-num">${Math.round(rec.best1rm)}</div><div class="finish-lbl">est. 1RM</div></div>
      <div class="finish-cell"><div class="finish-num">${rec.count}</div><div class="finish-lbl">sessions</div></div>
      <div class="finish-cell"><div class="finish-num">${fmtVol(totalVol)}</div><div class="finish-lbl">lifetime lbs</div></div>
    </div>
    ${chart}
    <div class="chart-legend">
      <span><span class="legend-swatch" style="background:var(--primary);"></span> Top set</span>
      <span><span class="legend-swatch legend-dash"></span> Est. 1RM</span>
    </div>
    <div style="overflow-x:auto;">
      <table class="table mt-3">
        <thead><tr><th>Date</th><th>Top Set</th><th>Sets</th><th>Volume</th></tr></thead>
        <tbody>${histRows}</tbody>
      </table>
    </div>`;
};

// generic multi-series line chart
function svgLineChart(seriesArr, labels) {
  const all = seriesArr.flatMap(s => s.vals);
  if (all.length === 0) return '';
  let min = Math.min(...all), max = Math.max(...all);
  const range = (max - min) || 1;
  const yMin = min - range * 0.12, yMax = max + range * 0.12;
  const w = 340, h = 130, padL = 34, padR = 10, padY = 16;

  const seriesHtml = seriesArr.map(s => {
    const n = s.vals.length;
    const pts = s.vals.map((v, i) => {
      const x = padL + (n === 1 ? 0.5 : i / (n - 1)) * (w - padL - padR);
      const y = h - padY - ((v - yMin) / (yMax - yMin)) * (h - padY * 2);
      return [x, y];
    });
    const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    const dots = s.dash ? '' : pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.6" fill="${s.color}" />`).join('');
    return `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>${dots}`;
  }).join('');

  return `
    <svg class="line-chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <text x="2" y="${padY + 4}" class="chart-axis">${Math.round(max)}</text>
      <text x="2" y="${h - padY + 4}" class="chart-axis">${Math.round(min)}</text>
      <line x1="${padL}" y1="${h - padY}" x2="${w - padR}" y2="${h - padY}" stroke="var(--border)" stroke-width="1"/>
      ${seriesHtml}
    </svg>
    <div class="flex justify-between text-xs text-muted" style="padding-left:34px;">
      <span>${labels[0] || ''}</span><span>${labels[labels.length - 1] || ''}</span>
    </div>`;
}

function renderWeeklyVolumeChart(entries) {
  const weeks = 8;
  const now = new Date(); now.setHours(0,0,0,0);
  // week buckets ending today (rolling 7-day blocks)
  const buckets = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = new Date(now); end.setDate(now.getDate() - i * 7 + 1); // exclusive end
    const start = new Date(end); start.setDate(end.getDate() - 7);
    buckets.push({ start, end, vol: 0 });
  }
  entries.forEach(e => {
    const d = entryDate(e);
    if (!d) return;
    for (const b of buckets) {
      if (d >= b.start && d < b.end) { b.vol += entryVolume(e); break; }
    }
  });
  const vals = buckets.map(b => Math.round(b.vol));
  const maxV = Math.max(...vals, 1);
  const w = 340, h = 140, padB = 20, padT = 18;
  const bw = (w / weeks) * 0.62;
  const bars = buckets.map((b, i) => {
    const x = (i + 0.5) * (w / weeks) - bw / 2;
    const bh = (b.vol / maxV) * (h - padB - padT);
    const y = h - padB - bh;
    const label = b.start.toLocaleDateString('en-US', { month:'numeric', day:'numeric' });
    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(bh, 2).toFixed(1)}" rx="3"
            fill="${i === weeks - 1 ? 'var(--primary)' : accentRGBA(0.45)}" />
      ${b.vol > 0 ? `<text x="${(x + bw/2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" class="chart-axis">${fmtVol(b.vol)}</text>` : ''}
      <text x="${(x + bw/2).toFixed(1)}" y="${h - 6}" text-anchor="middle" class="chart-axis">${label}</text>`;
  }).join('');
  return `<svg class="bar-chart-svg" viewBox="0 0 ${w} ${h}">${bars}</svg>`;
}

function renderMuscleSplit(entries) {
  const monthMs = 30 * 86400000, now = Date.now();
  const counts = {};
  entries.forEach(e => {
    const d = entryDate(e);
    if (!d || now - d.getTime() > monthMs) return;
    const sets = entrySetCount(e);
    entryMuscles(e).forEach(m => { counts[m] = (counts[m] || 0) + sets; });
  });
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return '<p class="text-sm text-muted">No workouts in the last 30 days.</p>';
  const maxC = rows[0][1];
  return rows.map(([m, c]) => `
    <div class="split-row">
      <span class="split-name">${esc(m)}</span>
      <div class="split-bar-track"><div class="split-bar" style="width:${Math.max(4, (c / maxC) * 100)}%;"></div></div>
      <span class="split-count">${c}</span>
    </div>`).join('');
}

// ─── FRIENDS ──────────────────────────────────────────────────────────────────
window.friendships = [];

async function loadFriendships() {
  if (!window.currentUser) { window.friendships = []; return []; }
  try {
    const snap = await getDocs(query(collection(db, 'friendships'), where('users', 'array-contains', window.currentUser.uid)));
    window.friendships = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) { console.error(err); window.friendships = []; }
  return window.friendships;
}

async function getAcceptedFriends() {
  if (!window.friendships.length) await loadFriendships();
  const me = window.currentUser?.uid;
  return window.friendships
    .filter(f => f.status === 'accepted')
    .map(f => {
      const uid = f.users.find(u => u !== me);
      return { uid, username: f.usernames?.[uid] || 'Friend', friendshipId: f.id };
    });
}

async function fetchFriendsFeed(friends, perFriend = 8) {
  const results = await Promise.all(friends.map(async f => {
    try {
      let docs;
      try {
        const snap = await getDocs(query(collection(db, 'journal'), where('uid', '==', f.uid), orderBy('createdAt', 'desc'), limit(perFriend)));
        docs = snap.docs;
      } catch (e) {
        const snap = await getDocs(query(collection(db, 'journal'), where('uid', '==', f.uid), limit(25)));
        docs = snap.docs.sort((a, b) => (b.data().createdAt?.seconds || 0) - (a.data().createdAt?.seconds || 0)).slice(0, perFriend);
      }
      return docs.map(d => ({ username: f.username, uid: f.uid, entry: { id: d.id, ...d.data() } }));
    } catch (err) { return []; }
  }));
  return results.flat().sort((a, b) => (b.entry.createdAt?.seconds || 0) - (a.entry.createdAt?.seconds || 0));
}

function friendsPage() {
  if (!window.currentUser) return loginPrompt('friends');
  setTimeout(renderFriends, 0);
  return `
    <div class="page-header"><div class="container-sm"><h1>Friends</h1><p>Train together, even apart.</p></div></div>
    <section class="section-tight"><div class="container-sm" id="friends-container"><div class="spinner"></div></div></section>`;
}

async function renderFriends() {
  const container = document.getElementById('friends-container');
  if (!container) return;
  await loadFriendships();
  if (!document.getElementById('friends-container')) return;
  const me = window.currentUser.uid;

  const incoming = window.friendships.filter(f => f.status === 'pending' && f.requestedBy !== me);
  const outgoing = window.friendships.filter(f => f.status === 'pending' && f.requestedBy === me);
  const friends  = await getAcceptedFriends();

  const incomingHtml = incoming.length ? `
    <div class="box mb-4">
      <div class="j-section-head"><p class="j-section-title">📥 Requests</p></div>
      ${incoming.map(f => {
        const uid = f.users.find(u => u !== me);
        const name = f.usernames?.[uid] || 'Someone';
        return `
          <div class="friend-row">
            <span class="avatar avatar-sm">${esc(name[0] || '?')}</span>
            <span class="font-bold text-white flex-grow">${esc(name)}</span>
            <button class="btn btn-primary btn-sm" onclick="acceptRequest('${f.id}')">Accept</button>
            <button class="btn btn-ghost btn-sm text-danger" onclick="declineRequest('${f.id}')">✕</button>
          </div>`;
      }).join('')}
    </div>` : '';

  const outgoingHtml = outgoing.length ? `
    <div class="box mb-4">
      <div class="j-section-head"><p class="j-section-title">📤 Sent</p></div>
      ${outgoing.map(f => {
        const uid = f.users.find(u => u !== me);
        const name = f.usernames?.[uid] || 'Someone';
        return `
          <div class="friend-row">
            <span class="avatar avatar-sm">${esc(name[0] || '?')}</span>
            <span class="text-mid flex-grow">${esc(name)} <span class="text-xs text-muted">(pending)</span></span>
            <button class="btn btn-ghost btn-sm text-danger" onclick="declineRequest('${f.id}')">Cancel</button>
          </div>`;
      }).join('')}
    </div>` : '';

  const friendsListHtml = `
    <div class="box mb-4">
      <div class="j-section-head"><p class="j-section-title">👥 My Friends</p><p class="text-xs text-muted">${friends.length}</p></div>
      ${friends.length === 0
        ? '<p class="text-sm text-muted">No friends yet — search below and send a request.</p>'
        : friends.map(f => `
          <div class="friend-row">
            <span class="avatar avatar-sm">${esc(f.username[0] || '?')}</span>
            <span class="font-bold text-white flex-grow">${esc(f.username)}</span>
            <button class="btn btn-ghost btn-sm text-danger" onclick="removeFriend('${f.friendshipId}')">Remove</button>
          </div>`).join('')}
    </div>`;

  const searchHtml = `
    <div class="box mb-4">
      <div class="j-section-head"><p class="j-section-title">🔍 Add a Friend</p></div>
      <div class="flex gap-2">
        <input class="input flex-grow" type="text" id="friend-search" placeholder="Search by username…"
               autocomplete="off" onkeydown="if(event.key==='Enter')searchUsers()" />
        <button class="btn btn-primary" onclick="searchUsers()">Search</button>
      </div>
      <div id="friend-search-results" class="mt-3"></div>
    </div>`;

  container.innerHTML = `
    ${incomingHtml}
    <div class="box mb-4">
      <div class="j-section-head"><p class="j-section-title">🏁 This Week</p><p class="text-xs text-muted">last 7 days</p></div>
      <div id="leaderboard"><div class="spinner spinner-sm"></div></div>
    </div>
    ${friendsListHtml}
    ${searchHtml}
    ${outgoingHtml}
    <div class="j-section-head mt-5"><p class="j-section-title">📣 Friend Activity</p></div>
    <div id="friends-feed"><div class="spinner spinner-sm"></div></div>`;

  renderLeaderboardAndFeed(friends);
}

async function renderLeaderboardAndFeed(friends) {
  const feed = await fetchFriendsFeed(friends, 8);
  const feedEl = document.getElementById('friends-feed');
  const lbEl = document.getElementById('leaderboard');
  if (!feedEl || !lbEl) return;

  // Leaderboard: me + friends, last 7 days
  const weekAgo = Date.now() - 7 * 86400000;
  const myEntries = (window.myEntries || []).filter(e => entryDate(e) && entryDate(e).getTime() >= weekAgo);
  const rows = [{
    name: (window.currentUser.displayName || 'Me') + ' (you)',
    sessions: myEntries.length,
    vol: Math.round(myEntries.reduce((t, e) => t + entryVolume(e), 0)),
    me: true
  }];
  friends.forEach(f => {
    const es = feed.filter(x => x.uid === f.uid && entryDate(x.entry) && entryDate(x.entry).getTime() >= weekAgo).map(x => x.entry);
    rows.push({ name: f.username, sessions: es.length, vol: Math.round(es.reduce((t, e) => t + entryVolume(e), 0)), me: false });
  });
  rows.sort((a, b) => b.vol - a.vol || b.sessions - a.sessions);
  const medals = ['🥇', '🥈', '🥉'];
  lbEl.innerHTML = rows.map((r, i) => `
    <div class="lb-row ${r.me ? 'lb-me' : ''}">
      <span class="lb-rank">${medals[i] || (i + 1)}</span>
      <span class="font-bold ${r.me ? 'text-orange' : 'text-white'} flex-grow">${esc(r.name)}</span>
      <span class="text-sm text-mid">${r.sessions} workout${r.sessions !== 1 ? 's' : ''}</span>
      <span class="lb-vol">${fmtVol(r.vol)} lbs</span>
    </div>`).join('');

  if (friends.length === 0) {
    feedEl.innerHTML = '<p class="text-sm text-muted">Add friends to see their workouts here.</p>';
    return;
  }
  if (feed.length === 0) {
    feedEl.innerHTML = '<p class="text-sm text-muted">No friend workouts yet. You set the pace. 😤</p>';
    return;
  }
  feedEl.innerHTML = feed.slice(0, 15).map(f => entryCardHtml(f.entry, { username: f.username })).join('');
}

window.searchUsers = async function() {
  const term = document.getElementById('friend-search').value.trim().toLowerCase();
  const resultsEl = document.getElementById('friend-search-results');
  if (!term) { resultsEl.innerHTML = ''; return; }
  resultsEl.innerHTML = '<div class="spinner spinner-sm"></div>';
  try {
    const snap = await getDocs(collection(db, 'users'));
    const me = window.currentUser.uid;
    const relations = {};
    window.friendships.forEach(f => {
      const other = f.users.find(u => u !== me);
      relations[other] = f.status;
    });
    const seen = new Set();
    const matches = snap.docs.map(d => d.data())
      .filter(u => u.uid && u.uid !== me && (u.username || '').toLowerCase().includes(term))
      .filter(u => { if (seen.has(u.uid)) return false; seen.add(u.uid); return true; })
      .slice(0, 10);
    window._searchResults = matches;
    if (matches.length === 0) { resultsEl.innerHTML = '<p class="text-sm text-muted">No users found with that name.</p>'; return; }
    resultsEl.innerHTML = matches.map((u, i) => {
      const rel = relations[u.uid];
      let action;
      if (rel === 'accepted') action = '<span class="badge badge-green">Friends ✓</span>';
      else if (rel === 'pending') action = '<span class="badge badge-gray">Pending</span>';
      else action = `<button class="btn btn-primary btn-sm" onclick="sendFriendRequest(${i})">+ Add</button>`;
      return `
        <div class="friend-row">
          <span class="avatar avatar-sm">${esc((u.username || '?')[0])}</span>
          <span class="font-bold text-white flex-grow">${esc(u.username || u.email || 'User')}</span>
          ${action}
        </div>`;
    }).join('');
  } catch (err) { resultsEl.innerHTML = '<p class="text-sm text-danger">Search failed. Try again.</p>'; }
};

window.sendFriendRequest = async function(i) {
  const u = window._searchResults?.[i];
  if (!u || !window.currentUser) return;
  const me = window.currentUser.uid;
  const myName = window.currentUser.displayName || window.currentUser.email;
  try {
    await addDoc(collection(db, 'friendships'), {
      users: [me, u.uid],
      usernames: { [me]: myName, [u.uid]: u.username || u.email || 'User' },
      status: 'pending',
      requestedBy: me,
      createdAt: serverTimestamp()
    });
    toast(`Request sent to ${esc(u.username || 'user')}!`, 'success');
    await loadFriendships();
    renderFriends();
  } catch (err) { toast('Could not send request.', 'error'); }
};

window.acceptRequest = async function(id) {
  try {
    await updateDoc(doc(db, 'friendships', id), { status: 'accepted' });
    toast('Friend added! 🎉', 'success');
    await loadFriendships();
    renderFriends();
  } catch (err) { toast('Error accepting request.', 'error'); }
};

window.declineRequest = async function(id) {
  try {
    await deleteDoc(doc(db, 'friendships', id));
    await loadFriendships();
    renderFriends();
  } catch (err) { toast('Error.', 'error'); }
};

window.removeFriend = async function(id) {
  if (!await wmConfirm('Remove this friend?', 'Remove')) return;
  try {
    await deleteDoc(doc(db, 'friendships', id));
    await loadFriendships();
    renderFriends();
    toast('Friend removed.', 'info');
  } catch (err) { toast('Error.', 'error'); }
};

// ─── CALENDAR HEATMAP (kept) ─────────────────────────────────────────────────
function renderHeatmap(entries) {
  const weeks = 12;
  const today = new Date(); today.setHours(0,0,0,0);
  const start = new Date(today);
  start.setDate(today.getDate() - (weeks - 1) * 7 - today.getDay());

  const dayMap = {};
  entries.forEach(e => {
    const d = entryDate(e);
    if (!d) return;
    const key = d.toDateString();
    dayMap[key] = (dayMap[key] || 0) + 1;
  });

  const cells = [];
  for (let week = 0; week < weeks; week++) {
    for (let day = 0; day < 7; day++) {
      const d = new Date(start);
      d.setDate(start.getDate() + week * 7 + day);
      const isFuture = d > today;
      const count = isFuture ? 0 : (dayMap[d.toDateString()] || 0);
      const level = count === 0 ? 0 : count === 1 ? 1 : count <= 2 ? 2 : 3;
      const label = d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
      cells.push({ count, level, label, isFuture });
    }
  }
  return cells.map(c =>
    c.isFuture
      ? `<div class="heatmap-day heatmap-future"></div>`
      : `<div class="heatmap-day level-${c.level}" title="${c.label}: ${c.count} workout${c.count !== 1 ? 's' : ''}"></div>`
  ).join('');
}

// ─── MONTHLY CALENDAR (kept) ─────────────────────────────────────────────────
window.calMonth = new Date().getMonth();
window.calYear  = new Date().getFullYear();

function renderMonthlyCalendar(entries, month, year) {
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startWeekday = firstDay.getDay();
  const monthName = firstDay.toLocaleDateString('en-US', { month:'long', year:'numeric' });

  const dayMap = {};
  entries.forEach(e => {
    const d = entryDate(e);
    if (!d) return;
    if (d.getMonth() === month && d.getFullYear() === year) {
      const k = d.getDate();
      if (!dayMap[k]) dayMap[k] = [];
      dayMap[k].push(e);
    }
  });

  const today = new Date();
  const isCurrentMonth = today.getMonth() === month && today.getFullYear() === year;
  const todayDate = today.getDate();

  let html = `
    <div class="cal-header">
      <button class="btn btn-ghost btn-sm" onclick="prevMonth()" aria-label="Previous month">‹</button>
      <p class="font-bold text-white" style="font-size:15px;">${monthName}</p>
      <button class="btn btn-ghost btn-sm" onclick="nextMonth()" aria-label="Next month">›</button>
    </div>
    <div class="cal-weekdays">${['S','M','T','W','T','F','S'].map(d => `<div>${d}</div>`).join('')}</div>
    <div class="cal-grid">`;

  for (let i = 0; i < startWeekday; i++) html += `<div class="cal-day cal-empty"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const dayEntries = dayMap[day] || [];
    const isToday = isCurrentMonth && day === todayDate;
    const has = dayEntries.length > 0;
    const cls = ['cal-day', has ? 'has-workout' : '', isToday ? 'today' : ''].filter(Boolean).join(' ');
    html += `<div class="${cls}" ${has ? `onclick="showDayWorkouts(${day})"` : ''}>
      <span>${day}</span>
      ${has ? `<span class="cal-dot"></span>` : ''}
    </div>`;
  }
  html += '</div>';
  return html;
}

window.prevMonth = function() {
  if (window.calMonth === 0) { window.calMonth = 11; window.calYear--; } else window.calMonth--;
  rerenderCalendar();
};
window.nextMonth = function() {
  if (window.calMonth === 11) { window.calMonth = 0; window.calYear++; } else window.calMonth++;
  rerenderCalendar();
};
function rerenderCalendar() {
  const el = document.getElementById('monthly-calendar');
  if (el && window.cachedJournalEntries) el.innerHTML = renderMonthlyCalendar(window.cachedJournalEntries, window.calMonth, window.calYear);
}

window.showDayWorkouts = function(day) {
  if (!window.cachedJournalEntries) return;
  const dayEntries = window.cachedJournalEntries.filter(e => {
    const d = entryDate(e);
    return d && d.getDate() === day && d.getMonth() === window.calMonth && d.getFullYear() === window.calYear;
  });
  if (dayEntries.length === 0) return;
  const dateStr = new Date(window.calYear, window.calMonth, day).toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
  const body = dayEntries.map(e => `
    <div class="box mb-3">
      <p class="font-bold text-white mb-1">${esc(e.workoutTitle || 'Workout')}</p>
      <p class="text-sm text-muted">${esc(entryMuscles(e).join(', ') || '--')}</p>
      ${entryDetailHtml(e)}
    </div>`).join('');
  const overlay = document.createElement('div');
  overlay.className = 'modal active';
  overlay.innerHTML = `
    <div class="modal-overlay"></div>
    <div class="modal-card modal-lg">
      <div class="modal-header"><span class="modal-title">${dateStr}</span><button class="modal-close">&times;</button></div>
      <div class="modal-body">${body}</div>
    </div>`;
  const close = () => overlay.remove();
  overlay.querySelector('.modal-close').onclick = close;
  overlay.querySelector('.modal-overlay').onclick = close;
  document.body.appendChild(overlay);
};

// ─── BODY WEIGHT (kept) ──────────────────────────────────────────────────────
window.openBodyWeightModal = function() {
  if (!window.currentUser) { openModal('loginModal'); return; }
  document.getElementById('bw-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('bw-weight').value = '';
  document.getElementById('bw-notes').value = '';
  document.getElementById('bw-error').classList.add('hidden');
  openModal('bodyWeightModal');
};

window.logBodyWeight = async function() {
  if (!window.currentUser) return;
  const weight = parseFloat(document.getElementById('bw-weight').value);
  const unit   = document.getElementById('bw-unit').value;
  const date   = document.getElementById('bw-date').value;
  const notes  = document.getElementById('bw-notes').value.trim();
  const errorEl = document.getElementById('bw-error');
  if (!weight || isNaN(weight) || weight <= 0) {
    errorEl.textContent = 'Please enter a valid weight.'; errorEl.classList.remove('hidden'); return;
  }
  if (!date) { errorEl.textContent = 'Please select a date.'; errorEl.classList.remove('hidden'); return; }
  try {
    await addDoc(collection(db, 'bodyWeight'), {
      uid: window.currentUser.uid, weight, unit, date, notes,
      createdAt: serverTimestamp()
    });
    closeModal('bodyWeightModal');
    if (window.currentPage === 'progress') showPage('progress');
    toast('Body weight logged!', 'success');
  } catch (err) { errorEl.textContent = 'Error saving.'; errorEl.classList.remove('hidden'); }
};

window.deleteBodyWeight = async function(id) {
  if (!await wmConfirm('Delete this weight entry?')) return;
  try { await deleteDoc(doc(db, 'bodyWeight', id)); showPage('progress'); toast('Entry deleted.', 'info'); }
  catch (err) { toast('Error.', 'error'); }
};

function renderWeightChart(entries) {
  if (entries.length < 2) return `<p class="text-sm text-muted" style="text-align:center;padding:18px;">Log at least 2 entries to see a chart.</p>`;
  const sorted = entries.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const recent = sorted.slice(-30);
  const weights = recent.map(e => e.weight);
  const minW = Math.min(...weights), maxW = Math.max(...weights);
  const range = (maxW - minW) || 1;
  const padR = range * 0.1;
  const yMin = minW - padR, yMax = maxW + padR;
  const yRange = yMax - yMin;
  const w = 320, h = 100, pad = 12;
  const points = recent.map((e, i) => {
    const x = pad + (i / Math.max(1, recent.length - 1)) * (w - pad * 2);
    const y = h - pad - ((e.weight - yMin) / yRange) * (h - pad * 2);
    return [x, y];
  });
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = path + ` L ${points[points.length-1][0].toFixed(1)} ${h - pad} L ${points[0][0].toFixed(1)} ${h - pad} Z`;
  return `
    <svg class="weight-chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <path d="${area}" fill="${accentRGBA(0.18)}" stroke="none" />
      <path d="${path}" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round" />
      ${points.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.5" fill="var(--primary)" />`).join('')}
    </svg>
    <div class="flex justify-between text-xs text-muted mt-1">
      <span>${recent[0].date}</span>
      <span>${recent[recent.length-1].weight} ${recent[recent.length-1].unit}</span>
      <span>${recent[recent.length-1].date}</span>
    </div>`;
}

function renderBodyWeightSection(entries) {
  if (entries.length === 0) {
    return `
      <div class="bw-section">
        <div class="j-section-head">
          <p class="j-section-title">⚖️ Body Weight</p>
          <button class="btn btn-primary btn-sm" onclick="openBodyWeightModal()">+ Log Weight</button>
        </div>
        <p class="text-sm text-muted" style="text-align:center;padding:20px 0;">Start tracking your body weight to see trends over time.</p>
      </div>`;
  }
  const sorted = entries.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const current = sorted[0];
  const monthAgoTs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const monthAgo = sorted.find(e => new Date(e.date).getTime() <= monthAgoTs) || sorted[sorted.length - 1];
  const change = current.weight - monthAgo.weight;
  const changeAbs = Math.abs(change).toFixed(1);
  const dir = change < -0.05 ? 'down' : change > 0.05 ? 'up' : 'flat';
  const arrow = dir === 'down' ? '↓' : dir === 'up' ? '↑' : '→';

  const recentList = sorted.slice(0, 4).map(e => `
    <div class="bw-entry-row">
      <span>${esc(e.date)} <strong class="text-white ml-2">${e.weight} ${esc(e.unit)}</strong></span>
      <a class="text-xs text-danger" onclick="deleteBodyWeight('${e.id}')">Delete</a>
    </div>`).join('');

  return `
    <div class="bw-section">
      <div class="j-section-head">
        <p class="j-section-title">⚖️ Body Weight</p>
        <button class="btn btn-primary btn-sm" onclick="openBodyWeightModal()">+ Log Weight</button>
      </div>
      <div class="bw-current">
        <span class="bw-current-val">${current.weight}</span>
        <span class="bw-current-unit">${esc(current.unit)}</span>
        <span class="bw-change ${dir}">${arrow} ${changeAbs} ${esc(current.unit)} <span style="opacity:0.7;">(30d)</span></span>
      </div>
      ${renderWeightChart(entries)}
      <div class="bw-entries">${recentList}</div>
    </div>`;
}

// ─── 1RM CALCULATOR (kept) ───────────────────────────────────────────────────
window.updateCalc1RM = function() {
  const w = parseFloat(document.getElementById('calc-w').value) || 0;
  const r = parseFloat(document.getElementById('calc-r').value) || 0;
  const result = document.getElementById('calc-result');
  const grid = document.getElementById('calc-grid');
  if (w <= 0 || r <= 0) { result.textContent = '— lbs'; grid.innerHTML = ''; return; }
  const oneRM = w * (1 + r / 30);
  result.textContent = `${oneRM.toFixed(1)} lbs`;
  const rows = [
    { reps: 2, pct: 0.95 }, { reps: 3, pct: 0.93 }, { reps: 5, pct: 0.87 },
    { reps: 8, pct: 0.80 }, { reps: 10, pct: 0.75 }, { reps: 12, pct: 0.70 }
  ];
  grid.innerHTML = rows.map(p => `
    <div class="calc-cell">
      <div class="calc-cell-val">${Math.round(oneRM * p.pct)}</div>
      <div class="calc-cell-lbl">${p.reps}RM</div>
    </div>`).join('');
};

function render1RMSection() {
  return `
    <div class="calc-section">
      <div class="j-section-head"><p class="j-section-title">🧮 1RM Calculator</p></div>
      <p class="text-sm text-muted mb-3">Estimate your one-rep max using the Epley formula.</p>
      <div class="flex gap-2 items-end">
        <div class="field flex-grow" style="margin-bottom:0;">
          <label class="label">Weight (lbs)</label>
          <input class="input" type="number" inputmode="decimal" id="calc-w" placeholder="135" oninput="updateCalc1RM()" />
        </div>
        <div class="field flex-grow" style="margin-bottom:0;">
          <label class="label">Reps</label>
          <input class="input" type="number" inputmode="numeric" id="calc-r" placeholder="5" oninput="updateCalc1RM()" />
        </div>
      </div>
      <div class="calc-result" id="calc-result">— lbs</div>
      <p class="text-xs text-muted" style="text-align:center;">Estimated 1RM</p>
      <div class="calc-grid" id="calc-grid"></div>
    </div>`;
}

// ─── REST TIMER (kept + auto-start on set ✓) ─────────────────────────────────
window.restTimerInterval = null;
window.restTimerEnd = null;

window.startRestTimer = function(seconds) {
  cancelRestTimer();
  window.restTimerEnd = Date.now() + seconds * 1000;
  const timer = document.createElement('div');
  timer.id = 'rest-timer-display';
  document.body.appendChild(timer);
  const update = () => {
    const remaining = Math.max(0, Math.round((window.restTimerEnd - Date.now()) / 1000));
    timer.innerHTML = `
      <span style="font-size:18px;">⏱</span>
      <span class="rt-time">${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}</span>
      <button class="btn btn-ghost btn-sm" onclick="cancelRestTimer()" style="padding:4px 10px;">×</button>`;
    if (remaining <= 10 && remaining > 0) timer.classList.add('warn');
    if (remaining === 0) {
      cancelRestTimer();
      toast('Rest complete! 💪', 'success');
      haptic([200, 100, 200]);
    }
  };
  update();
  window.restTimerInterval = setInterval(update, 500);
};
window.cancelRestTimer = function() {
  if (window.restTimerInterval) clearInterval(window.restTimerInterval);
  const t = document.getElementById('rest-timer-display');
  if (t) t.remove();
  window.restTimerInterval = null;
};

// ─── LOGIN PROMPT (for auth-gated pages) ─────────────────────────────────────
function loginPrompt(what) {
  return `
    <section class="section"><div class="container-sm">
      <div class="empty-state">
        <div class="empty-state-icon">🔒</div>
        <h3>Log in to see ${what}</h3>
        <p>Your data is waiting for you.</p>
        <a class="btn btn-primary" onclick="openModal('loginModal')">Log In</a>
      </div>
    </div></section>`;
}

// ─── SETTINGS PAGE ────────────────────────────────────────────────────────────
function settingsPage() {
  setTimeout(renderSettings, 0);
  return `
    <div class="page-header"><div class="container-sm"><h1>Settings</h1><p>Make it yours.</p></div></div>
    <section class="section-tight"><div class="container-sm" id="settings-container"></div></section>`;
}

function toggleRow(key, label, sub) {
  const on = getSetting(key);
  return `
    <div class="set-row2">
      <div class="flex-grow">
        <div class="set-row2-label">${label}</div>
        <div class="set-row2-sub">${sub}</div>
      </div>
      <button class="toggle ${on ? 'on' : ''}" role="switch" aria-checked="${on}" onclick="toggleBoolSetting('${key}')"></button>
    </div>`;
}

function renderSettings() {
  const el = document.getElementById('settings-container');
  if (!el) return;
  window.pendingAccent = null;   // clear any un-confirmed custom preview
  const s = window.wmSettings;
  const isPreset = ACCENT_PRESETS.some(p => p.hex.toLowerCase() === s.accent.toLowerCase());

  const swatches = ACCENT_PRESETS.map(p => `
    <button class="swatch ${p.hex.toLowerCase() === s.accent.toLowerCase() ? 'on' : ''}"
            style="background:${p.hex};" title="${p.name}" aria-label="${p.name}"
            onclick="setAccent('${p.hex}')"></button>`).join('');

  const stepChips = [2.5, 5, 10].map(v => `
    <button class="chip chip-sm ${s.weightStep === v ? 'chip-on' : ''}" onclick="setWeightStep(${v})">${v} lb</button>`).join('');

  const restChips = [0, 60, 90, 120, 180].map(v => `
    <button class="chip chip-sm ${s.restDefault === v ? 'chip-on' : ''}" onclick="setRestSetting(${v})">${v === 0 ? 'Off' : v < 120 ? v + 's' : (v/60) + 'm'}</button>`).join('');

  el.innerHTML = `
    <div class="box mb-4">
      <div class="j-section-head"><p class="j-section-title">🎨 Accent Color</p></div>
      <p class="text-sm text-muted mb-3">Pick a color — it themes the whole app instantly.</p>
      <div class="accent-grid">${swatches}</div>
      <div class="custom-accent">
        <div class="ca-left">
          <input type="color" id="ca-input" value="${s.accent}" oninput="previewAccent(this.value)" onchange="previewAccent(this.value)" />
          <div class="ca-text">
            <div class="set-row2-label">Custom color</div>
            <div class="set-row2-sub" id="ca-hex">${esc(s.accent.toUpperCase())}${!isPreset ? ' · Active' : ''}</div>
          </div>
        </div>
        <button class="btn btn-primary btn-sm" id="ca-confirm" onclick="confirmAccent()" disabled>Use color</button>
      </div>
      <p class="text-xs text-muted mt-2">Drag to preview live, then tap <strong>Use color</strong> to keep it.</p>
    </div>

    <div class="box mb-4">
      <div class="j-section-head"><p class="j-section-title">🏋 Logging</p></div>
      <div class="mb-3">
        <div class="set-row2-label mb-2">Weight increment <span class="text-muted" style="font-weight:400;">(± buttons)</span></div>
        <div class="chip-row">${stepChips}</div>
      </div>
      <div class="mb-1">
        <div class="set-row2-label mb-2">Default rest timer</div>
        <div class="chip-row">${restChips}</div>
      </div>
      ${toggleRow('autoRest', 'Auto-start rest timer', 'Start the timer when you check off a set')}
      ${toggleRow('haptics', 'Haptic feedback', 'Vibrate on set complete & timer end')}
    </div>

    <div class="box mb-4">
      <div class="j-section-head"><p class="j-section-title">ℹ️ About</p></div>
      <div class="set-row2"><div class="set-row2-label">WeightMate</div><span class="text-sm text-muted">v2.1</span></div>
      <div class="set-row2"><div class="set-row2-label">Signed in as</div><span class="text-sm text-muted">${esc(window.currentUser ? (window.currentUser.displayName || window.currentUser.email) : 'Not signed in')}</span></div>
      <button class="btn btn-outline btn-sm mt-3" onclick="resetSettings()">Reset all settings</button>
    </div>
    <p class="text-xs text-muted" style="text-align:center;">Settings are saved on this device.</p>`;
}

// Presets commit on a single tap.
window.setAccent = function(hex) {
  setSetting('accent', hex);
  applyAccent(hex);
  renderSettings();
};

// Custom picker: preview live WITHOUT re-rendering (so the picker stays open),
// then commit only when the user taps "Use color".
window.previewAccent = function(hex) {
  window.pendingAccent = hex;
  applyAccent(hex);   // visual only — not saved yet
  const hexEl = document.getElementById('ca-hex');
  if (hexEl) hexEl.textContent = hex.toUpperCase();
  const btn = document.getElementById('ca-confirm');
  if (btn) btn.disabled = hex.toLowerCase() === (window.wmSettings.accent || '').toLowerCase();
};
window.confirmAccent = function() {
  const hex = window.pendingAccent;
  if (!hex) return;
  setSetting('accent', hex);
  applyAccent(hex);
  window.pendingAccent = null;
  renderSettings();
  toast('Accent color saved!', 'success');
};
window.setWeightStep = function(v) { setSetting('weightStep', v); renderSettings(); };
window.setRestSetting = function(v) { setSetting('restDefault', v); renderSettings(); };
window.toggleBoolSetting = function(k) { setSetting(k, !getSetting(k)); renderSettings(); };
window.resetSettings = async function() {
  if (!await wmConfirm('Reset all settings to defaults? Your workouts are not affected.', 'Reset')) return;
  window.wmSettings = { ...DEFAULT_SETTINGS };
  saveSettings();
  applyAccent(DEFAULT_SETTINGS.accent);
  renderSettings();
  toast('Settings reset to defaults.', 'info');
};

// ─── ROUTER ───────────────────────────────────────────────────────────────────
window.currentPage = 'home';
const pages = { home: homePage, session: sessionPage, history: historyPage, progress: progressPage, friends: friendsPage, settings: settingsPage };

function showPage(pageId) {
  if (pageId !== 'session') stopElapsedTicker();
  window.currentPage = pageId;
  if (pages[pageId]) document.getElementById('app').innerHTML = pages[pageId]();
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelectorAll('.mn-item').forEach(l => l.classList.remove('active'));
  const navEl  = document.getElementById('nav-'  + pageId);
  const mnavEl = document.getElementById('mnav-' + pageId);
  if (navEl)  navEl.classList.add('active');
  if (mnavEl) mnavEl.classList.add('active');
  document.getElementById('navMenu')?.classList.remove('open');
  document.getElementById('navBurger')?.classList.remove('open');
  document.body.classList.toggle('in-session', pageId === 'session');
  updateFab();
  window.scrollTo(0, 0);
}

// ─── MODAL + SHEET HELPERS ───────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
function openSheet(id)  { document.getElementById(id).classList.add('active'); }
function closeSheet(id) { document.getElementById(id).classList.remove('active'); }

// ─── NAV BURGER ───────────────────────────────────────────────────────────────
document.getElementById('navBurger').addEventListener('click', function() {
  this.classList.toggle('open');
  document.getElementById('navMenu').classList.toggle('open');
});

// ─── KEYBOARD SHORTCUTS ───────────────────────────────────────────────────────
document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') logIn(); });
document.getElementById('signup-password').addEventListener('keydown', e => { if (e.key === 'Enter') signUp(); });

// ─── INITIAL RENDER ──────────────────────────────────────────────────────────
loadSettings();
applyAccent(getSetting('accent'));
showPage('home');

// ─── GLOBAL EXPORTS ──────────────────────────────────────────────────────────
window.showPage = showPage;
window.openModal = openModal;
window.closeModal = closeModal;
window.openSheet = openSheet;
window.closeSheet = closeSheet;
window._buildExerciseIndex = buildExerciseIndex; // debug/console use
