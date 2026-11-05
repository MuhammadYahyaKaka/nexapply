'use strict';
const $ = (s) => document.querySelector(s);
async function api(path, opts) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('Request failed (' + r.status + ')'));
  return j;
}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

async function init() {
  $('#redirectUri').textContent = location.origin + '/api/auth/google/callback';
  const st = await api('/api/admin/status');
  if (st.needsSetup) { $('#setupBox').classList.remove('hidden'); return; }
  if (!st.loggedIn) { $('#loginBox').classList.remove('hidden'); return; }
  showPanel();
}
function showPanel() {
  $('#setupBox').classList.add('hidden');
  $('#loginBox').classList.add('hidden');
  $('#panel').classList.remove('hidden');
  $('#adminNav').classList.remove('hidden');
  loadStats(); loadJobs(); loadUsers(); loadSettings();
}
$('#suBtn').addEventListener('click', async () => {
  try {
    await api('/api/admin/setup', { method: 'POST', body: JSON.stringify({ code: $('#suCode').value, email: $('#suEmail').value, password: $('#suPass').value }) });
    showPanel();
  } catch (e) { $('#suMsg').innerHTML = '<div class="error">' + esc(e.message) + '</div>'; }
});
$('#liBtn').addEventListener('click', async () => {
  try {
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ email: $('#liEmail').value, password: $('#liPass').value }) });
    showPanel();
  } catch (e) { $('#liMsg').innerHTML = '<div class="error">' + esc(e.message) + '</div>'; }
});
$('#adminLogout').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' });
  location.reload();
});
document.querySelectorAll('#adminNav button[data-tab]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#adminNav button[data-tab]').forEach(x => x.classList.toggle('active', x === b));
  for (const t of ['stats','jobs','users','settings']) $('#tab-' + t).classList.toggle('hidden', t !== b.dataset.tab);
}));

async function loadStats() {
  const s = await api('/api/admin/stats');
  $('#statsGrid').innerHTML = [
    ['Users', s.users], ['Jobs (active)', s.activeJobs + ' / ' + s.jobs], ['Applications', s.applications],
    ['Emails sent', s.emailsSent], ['Auto-apply users', s.autoApplyUsers]
  ].map(([k, v]) => '<div class="stat"><b>' + v + '</b>' + k + '</div>').join('');
  $('#statsNotes').innerHTML =
    'Verification-code emails (SMTP): <b>' + (s.smtpConfigured ? 'configured ✓' : 'NOT configured — codes are printed in the server console (demo mode)') + '</b><br>' +
    'Google connect (users sending from their own Gmail): <b>' + (s.googleConfigured ? 'configured ✓' : 'NOT configured — set Client ID/Secret in Settings') + '</b>';
}

let ALLJOBS = [];
async function loadJobs() {
  const r = await api('/api/admin/jobs');
  ALLJOBS = r.jobs;
  $('#jobsTable').innerHTML = ALLJOBS.length ? '<table><tr><th>Title</th><th>Company</th><th>City</th><th>Apply</th><th>Active</th><th></th></tr>' +
    ALLJOBS.map(j => '<tr><td>' + esc(j.title) + '</td><td>' + esc(j.company) + '</td><td>' + esc(j.city) + '</td><td>' +
      (j.applyType === 'email' ? 'Email: ' + esc(j.applyEmail) : 'Portal') + '</td><td>' + (j.active ? 'Yes' : 'No') + '</td>' +
      '<td><button class="btn small secondary" data-edit="' + j.id + '">Edit</button> <button class="btn small danger" data-del="' + j.id + '">Delete</button></td></tr>').join('') +
    '</table>' : '<p class="small">No jobs yet.</p>';
  $('#jobsTable').querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => fillJobForm(b.dataset.edit)));
  $('#jobsTable').querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this job?')) return;
    await api('/api/admin/jobs/' + b.dataset.del, { method: 'DELETE' });
    loadJobs(); loadStats();
  }));
}
function fillJobForm(id) {
  const j = ALLJOBS.find(x => x.id === id);
  if (!j) return;
  $('#jobFormTitle').textContent = 'Edit job';
  $('#jfId').value = j.id; $('#jfTitle').value = j.title; $('#jfCompany').value = j.company;
  $('#jfCity').value = j.city; $('#jfField').value = j.field || ''; $('#jfWorkType').value = j.workType;
  $('#jfDate').value = j.postingDate || ''; $('#jfSkills').value = (j.skills || []).join(', ');
  $('#jfApplyType').value = j.applyType; $('#jfApplyEmail').value = j.applyEmail || '';
  $('#jfApplyLink').value = j.applyLink || ''; $('#jfDesc').value = j.description || '';
  $('#jfActive').checked = j.active !== false;
  $('#jfCancel').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$('#jfCancel').addEventListener('click', () => {
  $('#jobFormTitle').textContent = 'Add a job';
  $('#jfId').value = ''; $('#jfCancel').classList.add('hidden');
  for (const id of ['jfTitle','jfCompany','jfCity','jfField','jfDate','jfSkills','jfApplyEmail','jfApplyLink','jfDesc']) $('#' + id).value = '';
});
$('#jfSave').addEventListener('click', async () => {
  const body = {
    title: $('#jfTitle').value, company: $('#jfCompany').value, city: $('#jfCity').value,
    field: $('#jfField').value, workType: $('#jfWorkType').value, postingDate: $('#jfDate').value,
    skills: $('#jfSkills').value, applyType: $('#jfApplyType').value, applyEmail: $('#jfApplyEmail').value,
    applyLink: $('#jfApplyLink').value, description: $('#jfDesc').value, active: $('#jfActive').checked
  };
  try {
    const id = $('#jfId').value;
    if (id) await api('/api/admin/jobs/' + id, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/api/admin/jobs', { method: 'POST', body: JSON.stringify(body) });
    $('#jfMsg').innerHTML = '<div class="okmsg">Job saved.</div>';
    $('#jfCancel').click();
    loadJobs(); loadStats();
  } catch (e) { $('#jfMsg').innerHTML = '<div class="error">' + esc(e.message) + '</div>'; }
});

async function loadUsers() {
  const r = await api('/api/admin/users');
  $('#usersTable').innerHTML = r.users.length ? '<table><tr><th>Email</th><th>Name</th><th>City</th><th>Signed up</th><th>CV</th><th>Google</th><th>Auto-apply</th><th>Applications</th></tr>' +
    r.users.map(u => '<tr><td>' + esc(u.email) + '</td><td>' + esc(u.name) + '</td><td>' + esc(u.city) + '</td><td>' +
      new Date(u.signupAt).toLocaleDateString() + '</td><td>' + (u.hasCv ? 'Yes' : 'No') + '</td><td>' +
      (u.googleConnected ? 'Connected' : '—') + '</td><td>' + (u.autoApply ? 'ON' : 'OFF') + '</td><td>' + u.applications + '</td></tr>').join('') +
    '</table>' : '<p class="small">No users yet.</p>';
}

async function loadSettings() {
  const r = await api('/api/admin/settings');
  const s = r.settings;
  $('#stSiteName').value = s.siteName;
  $('#stGid').value = s.googleClientId;
  $('#stGsecret').placeholder = s.googleClientSecretSet ? 'Secret saved — leave empty to keep it' : 'Paste the Google Client Secret';
  $('#stProdEmail').value = s.smtpProduct.email;
  $('#stProdPass').placeholder = s.smtpProduct.appPasswordSet ? 'App password saved — leave empty to keep it' : 'Gmail app password';
  $('#stOwnEmail').value = s.smtpOwner.email;
  $('#stOwnPass').placeholder = s.smtpOwner.appPasswordSet ? 'App password saved — leave empty to keep it' : 'Gmail app password';
  $('#stActive').value = s.smtpActive;
  $('#stThreshold').value = s.autoThreshold;
  $('#stCap').value = s.autoDailyCap;
}
$('#stSave').addEventListener('click', async () => {
  const body = {
    siteName: $('#stSiteName').value,
    googleClientId: $('#stGid').value, googleClientSecret: $('#stGsecret').value,
    smtpProduct: { email: $('#stProdEmail').value, appPassword: $('#stProdPass').value },
    smtpOwner: { email: $('#stOwnEmail').value, appPassword: $('#stOwnPass').value },
    smtpActive: $('#stActive').value,
    autoThreshold: Number($('#stThreshold').value), autoDailyCap: Number($('#stCap').value)
  };
  try {
    const r = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(body) });
    $('#stMsg').innerHTML = '<div class="okmsg">Settings saved. Verification email sending is now: <b>' + (r.smtpConfigured ? 'configured (real emails)' : 'demo mode (codes in server console)') + '</b>.</div>';
    $('#stGsecret').value = ''; $('#stProdPass').value = ''; $('#stOwnPass').value = '';
    loadSettings(); loadStats();
  } catch (e) { $('#stMsg').innerHTML = '<div class="error">' + esc(e.message) + '</div>'; }
});

init().catch(e => console.error(e));
