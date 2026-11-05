'use strict';
const $ = (s) => document.querySelector(s);
let ME = null, CONFIG = null, JOBS = [];

const LOCATIONS = ['Anywhere in Pakistan','Karachi','Lahore','Islamabad','Rawalpindi','Faisalabad','Multan','Peshawar','Quetta','Hyderabad','Sialkot','Gujranwala','Bahawalpur','Sargodha','Abbottabad','Remote'];
const WORKTYPES = ['On-site','Hybrid','Remote'];

async function api(path, opts) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('Request failed (' + r.status + ')'));
  return j;
}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// ------------------------------------------------------------------ init
async function init() {
  CONFIG = await api('/api/config');
  document.title = CONFIG.siteName + ' — Jobs matched to your CV, all over Pakistan';
  $('#siteLogo').textContent = CONFIG.siteName;
  const sbLogo = $('#sbLogo'); if (sbLogo) sbLogo.textContent = CONFIG.siteName;
  document.querySelectorAll('.siteNameTxt').forEach(e => e.textContent = CONFIG.siteName);
  $('#signupNotice').textContent = CONFIG.signupNotice;
  $('#demoNote').textContent = CONFIG.demoMode
    ? 'Demo mode: no email service is configured yet, so your verification code is shown to the site owner (server console) for testing.'
    : '';
  const params = new URLSearchParams(location.search);
  if (params.get('googleError')) alert('Google connect: ' + params.get('googleError'));
  try {
    const r = await api('/api/me');
    ME = r.user;
    showApp();
  } catch (e) { showGuest(); }
}
function showGuest() {
  $('#guestView').classList.remove('hidden');
  $('#appView').classList.add('hidden');
  $('#userNav').classList.add('hidden');
  $('#guestNav').classList.remove('hidden');
  $('#profileArea').classList.add('hidden');
  $('#appSidebar').classList.add('hidden');
  document.body.classList.remove('logged-in');
}
function updateProfileChip() {
  if (!ME) return;
  const initial = String(ME.firstName || ME.name || ME.email || '?').trim().charAt(0).toUpperCase() || '?';
  const displayName = ME.name || ME.email;
  $('#chipAvatar').textContent = initial;
  $('#chipName').textContent = displayName;
  $('#ddAvatar').textContent = initial;
  $('#ddName').textContent = displayName;
  $('#ddEmail').textContent = ME.email || '';
  $('#ddId').textContent = ME.id ? ('ID: ' + ME.id) : '';
  $('#sbAvatar').textContent = initial;
  $('#sbName').textContent = displayName;
}
function showApp() {
  $('#guestView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#userNav').classList.remove('hidden');
  $('#guestNav').classList.add('hidden');
  $('#profileArea').classList.remove('hidden');
  $('#appSidebar').classList.remove('hidden');
  document.body.classList.add('logged-in');
  updateProfileChip();
  fillProfile(); renderSettings(); loadJobs(); loadApplications();
  const params = new URLSearchParams(location.search);
  if (params.get('googleConnected')) switchView('settings');
}

// ------------------------------------------------------------------ auth
let SIGNUP_EMAIL = '';
function showAuth(which) {
  $('#loginForm').classList.toggle('hidden', which !== 'login');
  $('#signupForm').classList.toggle('hidden', which !== 'signup');
  $('#verifyForm').classList.toggle('hidden', which !== 'verify');
  $('#navLoginBtn').classList.toggle('active', which === 'login');
  $('#navSignupBtn').classList.toggle('active', which !== 'login');
}
$('#navLoginBtn').addEventListener('click', () => showAuth('login'));
$('#navSignupBtn').addEventListener('click', () => showAuth('signup'));
$('#toSignup').addEventListener('click', (e) => { e.preventDefault(); showAuth('signup'); });
$('#toLogin').addEventListener('click', (e) => { e.preventDefault(); showAuth('login'); });
$('#loginBtn').addEventListener('click', async () => {
  const email = $('#loginEmail').value.trim();
  const password = $('#loginPassword').value;
  $('#loginError').innerHTML = '';
  try {
    const r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    ME = r.user;
    history.replaceState({}, '', '/');
    showApp();
  } catch (e) { $('#loginError').innerHTML = '<div class="error">' + esc(e.message) + '</div>'; }
});
$('#signupBtn').addEventListener('click', async () => {
  const body = {
    firstName: $('#suFirst').value.trim(),
    lastName: $('#suLast').value.trim(),
    email: $('#suEmail').value.trim(),
    password: $('#suPassword').value
  };
  $('#signupError').innerHTML = '';
  try {
    await api('/api/auth/signup', { method: 'POST', body: JSON.stringify(body) });
    SIGNUP_EMAIL = body.email;
    $('#codeSentTo').textContent = body.email;
    showAuth('verify');
  } catch (e) { $('#signupError').innerHTML = '<div class="error">' + esc(e.message) + '</div>'; }
});
$('#backBtn').addEventListener('click', () => showAuth('signup'));
$('#signupVerifyBtn').addEventListener('click', async () => {
  const code = $('#authCode').value.trim();
  $('#authError2').innerHTML = '';
  try {
    const r = await api('/api/auth/signup/verify', { method: 'POST', body: JSON.stringify({ email: SIGNUP_EMAIL, code }) });
    ME = r.user;
    history.replaceState({}, '', '/');
    showApp();
  } catch (e) { $('#authError2').innerHTML = '<div class="error">' + esc(e.message) + '</div>'; }
});
$('#profileChip').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#profileDropdown').classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
  const dd = $('#profileDropdown');
  if (dd && !dd.classList.contains('hidden') && !$('#profileArea').contains(e.target)) dd.classList.add('hidden');
});
$('#ddSettings').addEventListener('click', () => {
  $('#profileDropdown').classList.add('hidden');
  switchView('settings');
});
$('#ddLogout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  ME = null; location.href = '/';
});

// ------------------------------------------------------------------ nav
document.querySelectorAll('#userNav button[data-view]').forEach(b => {
  b.addEventListener('click', () => switchView(b.dataset.view));
});
function switchView(v) {
  document.querySelectorAll('#userNav button[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  for (const name of ['jobs','applications','profile','settings']) {
    $('#view-' + name).classList.toggle('hidden', name !== v);
  }
  if (v === 'applications') loadApplications();
  if (v === 'jobs') loadJobs();
}

// ------------------------------------------------------------------ jobs
let CV_DEFAULT_DONE = false;
let JOBS_PAGE = 1;
const PAGE_SIZE = 10;
async function loadJobs() {
  try {
    const r = await api('/api/jobs');
    JOBS = r.jobs;
    JOBS_PAGE = 1;
    $('#jobsIntro').textContent = (ME && (ME.skills || []).length)
      ? 'Sorted by how well each job matches your CV skills.'
      : 'No CV uploaded yet — showing all jobs added in the last 5 days, newest first. Upload your CV to see jobs matched to your skills.';
    // Once a CV is on file, the feed opens on "Matched to my CV" so the user
    // first sees every job related to their CV in one scroll (owner's rule).
    if (!CV_DEFAULT_DONE && ME && (ME.skills || []).length) {
      $('#jobFilter').value = 'cv';
      CV_DEFAULT_DONE = true;
    }
    renderJobs();
  } catch (e) { $('#jobsList').innerHTML = '<div class="error">' + esc(e.message) + '</div>'; }
}
function stateBadge(j) {
  if (j.state === 'applied') return '<span class="badge applied">Applied' + (j.stateMethod ? ' (' + j.stateMethod + ')' : '') + (j.appliedDate ? ' · ' + j.appliedDate : '') + '</span>';
  if (j.state === 'saved') return '<span class="badge saved">Saved</span>';
  if (j.state === 'skipped') return '<span class="badge skipped">Skipped</span>';
  return '';
}
function renderJobs() {
  const q = ($('#jobSearch').value || '').toLowerCase();
  const f = $('#jobFilter').value;
  const list = JOBS.filter(j => {
    if (q && !(j.title + ' ' + j.company + ' ' + j.city).toLowerCase().includes(q)) return false;
    if (f === 'cv' && !j.related) return false;
    if (f === 'email' && j.applyType !== 'email') return false;
    if (f === 'portal' && j.applyType !== 'portal') return false;
    if (f === 'saved' && j.state !== 'saved') return false;
    if (f === 'notapplied' && j.state === 'applied') return false;
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (JOBS_PAGE > totalPages) JOBS_PAGE = totalPages;
  if (JOBS_PAGE < 1) JOBS_PAGE = 1;
  const pageList = list.slice((JOBS_PAGE - 1) * PAGE_SIZE, JOBS_PAGE * PAGE_SIZE);
  $('#jobsList').innerHTML = pageList.length ? pageList.map(j => `
    <div class="job" data-id="${j.id}">
      <div class="job-head">
        <div>
          <h3>${esc(j.title)} ${j.applyType === 'email' ? '<span class="badge email">Email apply</span>' : '<span class="badge portal">Portal apply</span>'} ${stateBadge(j)}</h3>
          <div class="meta"><b>${esc(j.company)}</b> · ${esc(j.city)} · ${esc(j.workType)}${j.field ? ' · ' + esc(j.field) : ''}<br>
          Posted: ${esc(j.postingDate || '—')} · Skills: ${j.skills.map(esc).join(', ') || '—'}</div>
        </div>
        ${j.match === null || j.match === undefined ? '<div class="match"><span class="small">Add your CV<br>to see match</span></div>' : `<div class="match">${j.match}%<br><span class="small">match</span></div>`}
      </div>
    </div>`).join('')
    : '<div class="card"><p class="small">No jobs match this filter right now. New jobs are added by the site team — check back soon, and make sure your CV and preferences are up to date.</p></div>';
  document.querySelectorAll('.job').forEach(el => el.addEventListener('click', () => openJob(el.dataset.id)));
  const pager = $('#jobsPager');
  if (list.length > PAGE_SIZE) {
    pager.innerHTML =
      '<button class="btn secondary" id="pgPrev"' + (JOBS_PAGE <= 1 ? ' disabled' : '') + '>← Previous page</button>' +
      '<span class="small">Page ' + JOBS_PAGE + ' of ' + totalPages + ' · ' + list.length + ' jobs</span>' +
      '<button class="btn secondary" id="pgNext"' + (JOBS_PAGE >= totalPages ? ' disabled' : '') + '>Next page →</button>';
    const pv = $('#pgPrev'), nx = $('#pgNext');
    if (pv) pv.addEventListener('click', () => { JOBS_PAGE--; renderJobs(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    if (nx) nx.addEventListener('click', () => { JOBS_PAGE++; renderJobs(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  } else {
    pager.innerHTML = list.length ? '<span class="small">' + list.length + ' jobs</span>' : '';
  }
}
$('#jobSearch').addEventListener('input', () => { JOBS_PAGE = 1; renderJobs(); });
$('#jobFilter').addEventListener('change', () => { JOBS_PAGE = 1; renderJobs(); });

async function openJob(id) {
  try {
    const r = await api('/api/jobs/' + id);
    const j = r.job;
    const applied = j.state === 'applied';
    let applyBlock = '';
    if (applied) {
      applyBlock = '<div class="okmsg">You have already applied to this job' + (j.appliedDate ? ' on ' + j.appliedDate : '') + (j.stateMethod ? ' (' + j.stateMethod + ')' : '') + '. Applications are never sent twice.</div>';
    } else if (j.applyType === 'portal') {
      applyBlock = `<p class="small">This job is applied on the company's portal. Portal applications are always done by you yourself.</p>
        ${j.applyLink ? '<p><a class="btn" href="' + esc(j.applyLink) + '" target="_blank" rel="noopener">Open job &amp; apply</a></p>' : '<p class="small">Search for this job title on the company website / job portals to apply.</p>'}
        <p><button class="btn secondary" data-act="applied">I applied — mark as applied</button></p>`;
    } else {
      applyBlock = `<p class="small">This job accepts applications by email${j.applyEmail ? ' at <b>' + esc(j.applyEmail) + '</b>' : ''}.</p>
        <p><button class="btn" data-act="applyEmail">Apply now from my email</button></p>
        <p class="small">If your Google account is not connected, we will show you the ready-made cover letter to send yourself.</p>
        <p><button class="btn secondary" data-act="applied">I applied myself — mark as applied</button></p>`;
    }
    $('#jobModal').innerHTML = `
    <div class="modal-bg"><div class="modal">
      <div class="job-head"><h2 style="margin:0">${esc(j.title)}</h2><button class="btn secondary small" data-act="close">Close</button></div>
      <p class="meta" style="color:var(--muted)"><b>${esc(j.company)}</b> · ${esc(j.city)} · ${esc(j.workType)} · ${j.match === null || j.match === undefined ? 'Match: <b>add your CV to see your match</b>' : 'Match: <b>' + j.match + '%</b>'} ${j.applyType === 'email' ? '<span class="badge email">Email apply</span>' : '<span class="badge portal">Portal apply</span>'}</p>
      <p>${esc(j.description || '')}</p>
      <h4>Skills you have</h4><div class="chips">${j.haveSkills.length ? j.haveSkills.map(s => '<span class="chip">' + esc(s) + '</span>').join('') : '<span class="small">None of the listed skills yet</span>'}</div>
      <h4>Skills missing</h4><div class="chips">${j.missingSkills.length ? j.missingSkills.map(s => '<span class="chip miss">' + esc(s) + '</span>').join('') : '<span class="small">You have all the listed skills.</span>'}</div>
      <div id="modalMsg"></div>
      ${applyBlock}
      ${applied ? '' : `<p>
        <button class="btn secondary small" data-act="saved">${j.state === 'saved' ? 'Saved ✓' : 'Save job'}</button>
        <button class="btn secondary small" data-act="skipped">Skip</button>
        ${j.state ? '<button class="btn secondary small" data-act="clear">Clear mark</button>' : ''}
      </p>`}
      <div id="manualBox"></div>
    </div></div>`;
    $('#jobModal').classList.remove('hidden');
    $('#jobModal').querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => jobAction(id, b.dataset.act, j)));
  } catch (e) { alert(e.message); }
}
async function jobAction(id, act, job) {
  const msg = (html) => { const m = $('#modalMsg'); if (m) m.innerHTML = html; };
  if (act === 'close') { $('#jobModal').classList.add('hidden'); $('#jobModal').innerHTML = ''; loadJobs(); return; }
  if (act === 'applyEmail') {
    msg('<p class="small">Sending…</p>');
    try {
      const r = await api('/api/jobs/' + id + '/apply-email', { method: 'POST', body: '{}' });
      if (r.sent) {
        msg('<div class="okmsg">Application sent from your email. This job is now marked Applied.</div>');
        setTimeout(() => { $('#jobModal').classList.add('hidden'); loadJobs(); loadApplications(); }, 1200);
      } else {
        $('#manualBox').innerHTML = `<div class="notice">Your Google account is not connected yet, so we cannot send it for you. Send it yourself:<br>
          <b>To:</b> ${esc(r.applyEmail)}<br><b>Subject:</b> Application for ${esc(job.title)} — ${esc(ME.name || ME.email)}</div>
          <h4>Ready cover letter (copy &amp; paste, attach your CV)</h4><pre class="letter">${esc(r.coverLetter)}</pre>
          <p><button class="btn secondary" data-act="applied">I sent it — mark as applied</button></p>`;
        $('#manualBox').querySelector('[data-act="applied"]').addEventListener('click', () => jobAction(id, 'applied', job));
      }
    } catch (e) { msg('<div class="error">' + esc(e.message) + '</div>'); }
    return;
  }
  try {
    await api('/api/jobs/' + id + '/state', { method: 'POST', body: JSON.stringify({ state: act === 'clear' ? null : act }) });
    $('#jobModal').classList.add('hidden'); $('#jobModal').innerHTML = '';
    loadJobs(); loadApplications();
  } catch (e) { msg('<div class="error">' + esc(e.message) + '</div>'); }
}

// ------------------------------------------------------------------ applications
async function loadApplications() {
  try {
    const r = await api('/api/me/applications');
    const apps = r.applications;
    const applied = apps.filter(a => a.status === 'applied');
    $('#appsStats').innerHTML = `
      <div class="stat-cards">
        <div class="stat"><b>${apps.length}</b><span>Total tracked</span></div>
        <div class="stat"><b>${applied.length}</b><span>Applied</span></div>
        <div class="stat"><b>${apps.filter(a => a.status === 'saved').length}</b><span>Saved</span></div>
        <div class="stat"><b>${apps.filter(a => a.status === 'skipped').length}</b><span>Skipped</span></div>
      </div>`;
    $('#appsList').innerHTML = apps.length ? `
      <table><tr><th>Job</th><th>Company</th><th>Status</th><th>Date applied</th></tr>
      ${apps.map(a => `<tr><td>${esc(a.title)}</td><td>${esc(a.company)}<br><span class="small">${esc(a.city)}</span></td>
        <td>${a.status === 'applied' ? 'Applied' + (a.method ? ' (' + a.method + ')' : '') : a.status === 'saved' ? 'Saved' : 'Skipped'}</td>
        <td>${a.appliedDate || '—'}</td></tr>`).join('')}
      </table>` : '<p class="small">Nothing here yet. Save or apply to a job and it will show up.</p>';
  } catch (e) { $('#appsList').innerHTML = '<div class="error">' + esc(e.message) + '</div>'; }
}

// ------------------------------------------------------------------ profile / CV / skills
function fillProfile() {
  if (!ME) return;
  $('#pfName').value = ME.name || '';
  $('#pfCity').value = ME.city || '';
  $('#pfPhone').value = ME.phone || '';
  $('#cvInfo').innerHTML = ME.cv
    ? '<div class="okmsg">CV on file: <b>' + esc(ME.cv.fileName) + '</b> (uploaded ' + new Date(ME.cv.uploadedAt).toLocaleDateString() + ')</div>'
    : '<div class="notice">No CV uploaded yet. Upload your CV so we can match jobs to your skills.</div>';
  $('#removeCvBtn').classList.toggle('hidden', !ME.cv);
  renderSkills(); renderPrefs();
}
$('#saveProfileBtn').addEventListener('click', async () => {
  try {
    const r = await api('/api/me/profile', { method: 'PUT', body: JSON.stringify({ name: $('#pfName').value, city: $('#pfCity').value, phone: $('#pfPhone').value }) });
    ME = r.user;
    updateProfileChip();
    $('#profileMsg').innerHTML = '<div class="okmsg">Profile saved.</div>';
  } catch (e) { $('#profileMsg').innerHTML = '<div class="error">' + esc(e.message) + '</div>'; }
});
$('#uploadCvBtn').addEventListener('click', async () => {
  const f = $('#cvFile').files[0];
  if (!f) { $('#cvMsg').innerHTML = '<div class="error">Please choose a CV file first.</div>'; return; }
  const fd = new FormData(); fd.append('cv', f);
  $('#cvMsg').innerHTML = '<p class="small">Uploading…</p>';
  try {
    const r = await fetch('/api/me/cv', { method: 'POST', body: fd });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Upload failed');
    ME = j.user;
    fillProfile();
    $('#cvMsg').innerHTML = '<div class="okmsg">CV uploaded. Skills found in your CV: ' +
      (j.detectedSkills.length ? j.detectedSkills.map(esc).join(', ') : 'none detected — please add your skills below by hand') + '.</div>';
    loadJobs();
  } catch (e) { $('#cvMsg').innerHTML = '<div class="error">' + esc(e.message) + '</div>'; }
});
$('#removeCvBtn').addEventListener('click', async () => {
  if (!confirm('Remove your CV? Auto-apply will stop until you upload a new one.')) return;
  const r = await api('/api/me/cv', { method: 'DELETE' });
  ME = r.user; fillProfile(); loadJobs();
});
function renderSkills() {
  $('#skillChips').innerHTML = (ME.skills || []).map(s =>
    '<span class="chip">' + esc(s) + '<button data-skill="' + esc(s) + '" title="Remove">×</button></span>').join('') ||
    '<span class="small">No skills yet.</span>';
  $('#skillChips').querySelectorAll('button').forEach(b => b.addEventListener('click', async () => {
    ME.skills = ME.skills.filter(s => s !== b.dataset.skill);
    const r = await api('/api/me/skills', { method: 'PUT', body: JSON.stringify({ skills: ME.skills }) });
    ME = r.user; renderSkills(); loadJobs();
  }));
}
$('#addSkillBtn').addEventListener('click', async () => {
  const v = $('#newSkill').value.trim();
  if (!v) return;
  ME.skills = [...new Set([...(ME.skills || []), v])];
  const r = await api('/api/me/skills', { method: 'PUT', body: JSON.stringify({ skills: ME.skills }) });
  ME = r.user; $('#newSkill').value = ''; renderSkills(); loadJobs();
});
function chipEditor(list, containerId, onChange) {
  const c = $(containerId);
  c.innerHTML = list.map(v => '<span class="chip">' + esc(v) + '<button data-v="' + esc(v) + '">×</button></span>').join('');
  c.querySelectorAll('button').forEach(b => b.addEventListener('click', () => onChange(list.filter(x => x !== b.dataset.v))));
}
function checkChips(all, selected, containerId, onChange) {
  const c = $(containerId);
  c.innerHTML = all.map(v => {
    const on = selected.includes(v);
    return '<span class="chip' + (on ? '' : ' miss') + '" data-v="' + esc(v) + '" style="cursor:pointer">' + (on ? '✓ ' : '+ ') + esc(v) + '</span>';
  }).join('');
  c.querySelectorAll('.chip').forEach(ch => ch.addEventListener('click', () => {
    const v = ch.dataset.v;
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  }));
}
function renderPrefs() {
  const prefs = ME.preferences || { roles: [], locations: [], workTypes: [] };
  chipEditor(prefs.roles.slice(), '#roleChips', (roles) => { ME.preferences.roles = roles; renderPrefs(); });
  checkChips(LOCATIONS, prefs.locations, '#locChips', (locations) => { ME.preferences.locations = locations; renderPrefs(); });
  checkChips(WORKTYPES, prefs.workTypes, '#typeChips', (workTypes) => { ME.preferences.workTypes = workTypes; renderPrefs(); });
}
$('#addRoleBtn').addEventListener('click', () => {
  const v = $('#newRole').value.trim();
  if (!v) return;
  ME.preferences.roles = [...new Set([...(ME.preferences.roles || []), v])];
  $('#newRole').value = ''; renderPrefs();
});
$('#newRole').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#addRoleBtn').click(); } });
$('#savePrefsBtn').addEventListener('click', async () => {
  try {
    const r = await api('/api/me/preferences', { method: 'PUT', body: JSON.stringify(ME.preferences) });
    ME = r.user;
    $('#prefsMsg').innerHTML = '<div class="okmsg">Preferences saved. Job matching updated.</div>';
    loadJobs();
  } catch (e) { $('#prefsMsg').innerHTML = '<div class="error">' + esc(e.message) + '</div>'; }
});

// ------------------------------------------------------------------ settings: google + auto-apply
function renderSettings() {
  if (!ME) return;
  $('#myEmail').textContent = ME.email;
  const box = $('#googleBox');
  if (ME.googleConnected) {
    box.innerHTML = '<div class="okmsg">Google connected: <b>' + esc(ME.googleEmail || ME.email) + '</b> — application emails will be sent from this account.</div>' +
      '<p><button class="btn danger" id="gDisconnect">Disconnect Google</button></p>';
    $('#gDisconnect').addEventListener('click', async () => {
      const r = await api('/api/me/google/disconnect', { method: 'POST' });
      ME = r.user; renderSettings();
    });
  } else if (!CONFIG.googleConfigured && !CONFIG.demoGoogle) {
    box.innerHTML = '<div class="notice">Google connect is <b>not set up yet</b> by the site admin, so one-click and auto-apply sending are not available yet. You can still apply to every job yourself using the apply links and ready cover letters.</div>';
  } else {
    box.innerHTML = '<p><a class="btn" href="/api/me/google/connect">Connect my Google account</a></p>' +
      '<p class="small">You will sign in on Google\'s own page and allow only "send email" permission. Connect the Google account with the same email as this account (' + esc(ME.email) + ').</p>';
  }
  $('#autoToggle').checked = ME.autoApply;
  $('#autoState').textContent = ME.autoApply ? 'ON' : 'OFF';
  $('#autoConsent').checked = ME.autoApply;
  if (ME.autoApplyNeedsAttention) {
    $('#autoMsg').innerHTML = '<div class="error">Auto-apply needs your attention: sending from your email failed (your Google connection may have been removed). Please disconnect and connect Google again, then turn auto-apply on.</div>';
  }
  renderTimer();
}
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function timerWindowText(t) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const names = order.filter(d => (t.days || []).includes(d)).map(d => DAY_NAMES[d]);
  return (names.length ? names.join(', ') : 'no days') + ' · ' + (t.start || '10:00') + ' – ' + (t.end || '15:00') + ' PKT';
}
function renderTimer() {
  if (!ME) return;
  const t = ME.autoTimer || { on: false, days: [1, 2, 3, 4, 5], start: '10:00', end: '15:00' };
  $('#timerToggle').checked = Boolean(t.on);
  $('#timerState').textContent = t.on ? 'ON' : 'OFF';
  document.querySelectorAll('#timerDays input').forEach(cb => { cb.checked = (t.days || []).includes(Number(cb.value)); });
  $('#timerStart').value = t.start || '10:00';
  $('#timerEnd').value = t.end || '15:00';
  if (!t.on) {
    $('#timerStatus').innerHTML = '<div class="notice">Timer is OFF — auto-apply will not run for you until you turn the timer ON and save.</div>';
  } else if (ME.timerActiveNow) {
    $('#timerStatus').innerHTML = '<div class="okmsg">Timer is ON and <b>active right now</b> — window: ' + esc(timerWindowText(t)) + '.</div>';
  } else {
    $('#timerStatus').innerHTML = '<div class="notice">Timer is ON, but right now is <b>outside</b> your window — window: ' + esc(timerWindowText(t)) + '. Auto-apply will run when your window opens.</div>';
  }
}
$('#timerSaveBtn').addEventListener('click', async () => {
  $('#timerMsg').innerHTML = '';
  const days = [...document.querySelectorAll('#timerDays input:checked')].map(cb => Number(cb.value));
  try {
    const r = await api('/api/me/autotimer', {
      method: 'PUT',
      body: JSON.stringify({ on: $('#timerToggle').checked, days, start: $('#timerStart').value, end: $('#timerEnd').value })
    });
    ME = r.user; renderSettings();
    $('#timerMsg').innerHTML = '<div class="okmsg">Timer saved.</div>';
  } catch (e) { $('#timerMsg').innerHTML = '<div class="error">' + esc(e.message) + '</div>'; }
});
$('#autoToggle').addEventListener('change', async () => {
  const on = $('#autoToggle').checked;
  $('#autoMsg').innerHTML = '';
  try {
    const r = await api('/api/me/autoapply', { method: 'PUT', body: JSON.stringify({ on, consent: $('#autoConsent').checked }) });
    ME = r.user; renderSettings();
    if (on) $('#autoMsg').innerHTML = '<div class="okmsg">Auto-apply is ON. Matching email-jobs will be applied from your own email automatically — inside your timer window below.</div>';
  } catch (e) {
    $('#autoToggle').checked = !on;
    $('#autoMsg').innerHTML = '<div class="error">' + esc(e.message) + '</div>';
  }
});

init().catch(e => console.error(e));
