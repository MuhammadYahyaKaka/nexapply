'use strict';
/*
 * NexApply — public multi-user job-matching website for Pakistan.
 * Single-file Node.js server (built-ins only, plus nodemailer for SMTP).
 * Data: data/db.json (auto-created). CV files: uploads/.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (e) { /* SMTP disabled until installed */ }

const PORT = process.env.PORT || 3000;
const DEMO_GOOGLE = process.env.DEMO_GOOGLE === '1'; // TEST HOOK ONLY — see README
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const OUTBOX_FILE = path.join(DATA_DIR, 'outbox.log');
const PUBLIC_DIR = path.join(ROOT, 'public');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------------------------------------------------------------- utilities
const now = () => Date.now();
const isoToday = () => new Date().toISOString().slice(0, 10);
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const randToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');
const uid = () => crypto.randomBytes(8).toString('hex');
function scryptHash(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return salt + ':' + hash;
}
function scryptVerify(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}
const escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const normEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

// ---------------------------------------------------------------- database
const SEED_JOBS = [
  {
    title: 'Frontend / JavaScript Developer (Onsite)', company: 'Bestel Tech',
    city: 'Karachi', workType: 'On-site', field: 'IT / Software',
    skills: ['JavaScript', 'React', 'HTML', 'CSS', 'UI/UX Design', 'Responsive Design'],
    applyType: 'email', applyEmail: 'mohammad.mujtaba@bestel.tech', applyLink: '',
    link: 'https://www.apnijobs.pk/31/frontend-javascript-developer-onsite.html',
    postingDate: 'Not shown (found 2026-11-05)',
    description: 'Frontend / JavaScript developer role (onsite, Karachi). Strong match for JavaScript developers; React a plus; UI/UX and responsive design work.'
  },
  {
    title: 'Front End Web Developer', company: 'TECHI GEMS PAKISTAN',
    city: 'Karachi', workType: 'On-site', field: 'IT / Software',
    skills: ['HTML', 'CSS', 'JavaScript', 'React'],
    applyType: 'portal', applyEmail: '', applyLink: 'https://pk.indeed.com/viewjob?jk=eb53a1e6cb4e19ed',
    link: 'https://pk.indeed.com/viewjob?jk=eb53a1e6cb4e19ed',
    postingDate: 'Not shown (found 2026-11-05)',
    description: 'Front End Web Developer — Karachi, Gulshan-e-Iqbal (onsite, night shift). Salary listed Rs 60,000–100,000. HTML/CSS/JavaScript with React framework.'
  },
  {
    title: 'React Js Intern', company: 'MMC',
    city: 'Karachi', workType: 'On-site', field: 'IT / Software',
    skills: ['React', 'JavaScript', 'Responsive Design'],
    applyType: 'portal', applyEmail: '', applyLink: '',
    link: '',
    postingDate: 'Not shown (found 2026-11-05)',
    description: 'React JS internship — Karachi, Gulshan-e-Iqbal. Building responsive web applications with React.'
  },
  {
    title: 'JavaScript / React.js / Node.js Developer', company: 'Levon Builder and Developers',
    city: 'Karachi', workType: 'On-site', field: 'IT / Software',
    skills: ['JavaScript', 'React', 'Node.js'],
    applyType: 'portal', applyEmail: '', applyLink: '',
    link: '',
    postingDate: 'Not shown (found 2026-11-05)',
    description: 'Developer role working with JavaScript, React.js and Node.js — Karachi.'
  }
];
// More real jobs harvested 2026-11-05 from public portals (Rozee, Indeed PK,
// Mustakbil and job boards) — posted within the last ~5 days where a date is
// shown; otherwise the posting date honestly says it was not shown.
const SEED_JOBS_MORE = [
  {
    "applyEmail": "",
    "applyLink": "https://www.rozee.pk/EN/full-stack-developer-reactjs-nodejs-mern-stack-lahore-jobs-1738446",
    "applyType": "portal",
    "city": "Lahore",
    "company": "Sprouto Group",
    "description": "Full-time onsite role in DHA Phase 8, Lahore, building web applications with React.js, Next.js and Node.js; requires 3+ years of JavaScript/TypeScript, React, Node, MongoDB and Express experience. Salary shown on listing: Rs 100,000 to Rs 120,000 per month.",
    "field": "IT / Software",
    "postingDate": "Not shown (found 2026-11-05)",
    "skills": [
      "React.js",
      "Node.js",
      "MongoDB",
      "Express.js",
      "TypeScript"
    ],
    "title": "Full Stack Developer (React.js + Node.js / MERN Stack)",
    "workType": "On-site",
    "link": "https://www.rozee.pk/EN/full-stack-developer-reactjs-nodejs-mern-stack-lahore-jobs-1738446"
  },
  {
    "applyEmail": "",
    "applyLink": "https://www.rozee.pk/metaproof-lead-full-stack-developer-react-node-nextjs-islamabad-lahore-jobs-1731480",
    "applyType": "portal",
    "city": "Remote",
    "company": "METAPROOF",
    "description": "Remote (Pakistan) lead role owning the technical architecture of a platform combining data, AI and blockchain for supply-chain transparency; minimum 5 years of professional experience, with occasional meetings possible in Lahore or Islamabad.",
    "field": "IT / Software",
    "postingDate": "Not shown (found 2026-11-05)",
    "skills": [
      "React.js",
      "Node.js",
      "Next.js",
      "MongoDB",
      "AWS"
    ],
    "title": "Lead Full Stack Developer - React / Node / Next.js",
    "workType": "Remote",
    "link": "https://www.rozee.pk/metaproof-lead-full-stack-developer-react-node-nextjs-islamabad-lahore-jobs-1731480"
  },
  {
    "applyEmail": "",
    "applyLink": "https://www.rozee.pk/job/jsearch/q/Node.js Developer - Intern",
    "applyType": "portal",
    "city": "Islamabad",
    "company": "Dartsyn LLC",
    "description": "Three-month unpaid internship at DartSyn, NUST Ascend Tower office in Islamabad, at a technology company working in IoT, robotics, web, mobile apps and AI.",
    "field": "IT / Software",
    "postingDate": "Nov 2, 2026",
    "skills": [
      "HTML",
      "CSS",
      "JavaScript",
      "React",
      "Node.js"
    ],
    "title": "Web Developer Intern",
    "workType": "On-site",
    "link": "https://www.rozee.pk/job/jsearch/q/Node.js Developer - Intern"
  },
  {
    "applyEmail": "",
    "applyLink": "https://www.rozee.pk/brand-manager-karachi-jobs-1935857",
    "applyType": "portal",
    "city": "Karachi",
    "company": "ZAKI Industrial Corporation",
    "description": "Managerial role driving growth of a leading FMCG brand, developing brand strategy and ATL/BTL campaigns while working across sales, trade, retail and e-commerce teams; requires 4-6 years of brand management experience.",
    "field": "Marketing",
    "postingDate": "Oct 31, 2026",
    "skills": [
      "Brand Strategy",
      "ATL/BTL Marketing",
      "Campaign Management",
      "Marketing Analytics",
      "Consumer Insights"
    ],
    "title": "Brand Manager",
    "workType": "On-site",
    "link": "https://www.rozee.pk/brand-manager-karachi-jobs-1935857"
  },
  {
    "applyEmail": "",
    "applyLink": "https://pk.indeed.com/q-social-media-marketing-remote-l-rawalpindi-urdu-bazar-jobs.html",
    "applyType": "portal",
    "city": "Remote",
    "company": "Capital Institute for Career Development",
    "description": "100% remote role planning and optimizing paid campaigns across Meta Ads and Google Ads plus managing social media channels; requires minimum 1 year of hands-on paid advertising experience. Salary shown on listing: PKR 40,000-60,000 per month.",
    "field": "Marketing",
    "postingDate": "Not shown (found 2026-11-05)",
    "skills": [
      "Meta Ads Manager",
      "Google Ads",
      "Social Media Management",
      "GA4",
      "Paid Campaigns"
    ],
    "title": "Social Media & Paid Marketing Executive - Remote",
    "workType": "Remote",
    "link": "https://pk.indeed.com/q-social-media-marketing-remote-l-rawalpindi-urdu-bazar-jobs.html"
  },
  {
    "applyEmail": "",
    "applyLink": "https://www.rozee.pk/UR/territory-sales-officer-karachi-jobs-1736540",
    "applyType": "portal",
    "city": "Karachi",
    "company": "Mezan Group",
    "description": "Mezan Beverages (Cola Next) is hiring Territory Sales Officers in Karachi to manage distributor relationships and hit sales, coverage and visibility targets; requires a bachelor's degree and 2-4 years of FMCG sales experience. Salary shown on listing: Rs 60,000 to Rs 80,000 per month plus incentives.",
    "field": "Sales",
    "postingDate": "Not shown (found 2026-11-05)",
    "skills": [
      "FMCG Sales",
      "Distributor Management",
      "Negotiation",
      "Route-to-Market",
      "MS Office"
    ],
    "title": "Territory Sales Officer",
    "workType": "On-site",
    "link": "https://www.rozee.pk/UR/territory-sales-officer-karachi-jobs-1736540"
  },
  {
    "applyEmail": "",
    "applyLink": "https://www.rozee.pk/sales-job-samundari-faisalabad-samundri-jobs-1935863",
    "applyType": "portal",
    "city": "Samundri",
    "company": "HRPSP - Your Strategic HR Partner",
    "description": "Field-based role in Samundri, Faisalabad promoting and selling broadband and telecommunication services; requires at least Intermediate education, a valid driving licence and own bike. Salary shown on listing: basic starting from PKR 40,700 per month plus performance-based commission.",
    "field": "Sales",
    "postingDate": "Oct 31, 2026",
    "skills": [
      "Field Sales",
      "Communication",
      "Customer Relationships",
      "Persuasive Selling"
    ],
    "title": "Sales Job - Samundari Faisalabad",
    "workType": "On-site",
    "link": "https://www.rozee.pk/sales-job-samundari-faisalabad-samundri-jobs-1935863"
  },
  {
    "applyEmail": "",
    "applyLink": "http://pk.indeed.com/Call-Center-jobs",
    "applyType": "portal",
    "city": "Islamabad",
    "company": "HRPSP - Your Strategic HR Partner",
    "description": "Full-time, in-person call center role in Islamabad for energetic, customer-focused individuals with good communication skills. Pay shown on listing: from Rs 40,000 per month.",
    "field": "Customer Support",
    "postingDate": "Not shown (found 2026-11-05)",
    "skills": [
      "Urdu Communication",
      "Customer Service",
      "Call Handling",
      "Communication Skills"
    ],
    "title": "Call Center Agent (Urdu)",
    "workType": "On-site",
    "link": "http://pk.indeed.com/Call-Center-jobs"
  },
  {
    "applyEmail": "",
    "applyLink": "https://pk.indeed.com/pakistan-call-center-Rs-360,000-jobs",
    "applyType": "portal",
    "city": "Karachi",
    "company": "1AZ0 Marketing (Pvt) Ltd",
    "description": "Call center agent openings in Gulshan-e-Iqbal, Karachi, open to freshers and students. Pay shown on listing: up to Rs 45,000 per month plus commission on sales.",
    "field": "Customer Support",
    "postingDate": "Not shown (found 2026-11-05)",
    "skills": [
      "Communication",
      "Telesales",
      "Customer Support",
      "Sales Targets"
    ],
    "title": "Call Center Agents (Freshers + Students)",
    "workType": "On-site",
    "link": "https://pk.indeed.com/pakistan-call-center-Rs-360,000-jobs"
  },
  {
    "applyEmail": "",
    "applyLink": "https://www.rozee.pk/senior-audit-manager-transaction-banking-operations-karachi-jobs-1935862",
    "applyType": "portal",
    "city": "Karachi",
    "company": "Standard Chartered",
    "description": "Lead and execute risk-based audits across the payments value chain (initiation, processing, clearing, settlement, reconciliation) at Standard Chartered in Karachi; background in internal/external audit, banking operations or technology risk required, CISA or CIA an advantage.",
    "field": "Accounts / Finance",
    "postingDate": "Oct 31, 2026",
    "skills": [
      "Internal Audit",
      "Banking Operations",
      "Risk & Controls",
      "Data Analytics",
      "CISA/CIA"
    ],
    "title": "Senior Audit Manager - Transaction Banking Operations",
    "workType": "On-site",
    "link": "https://www.rozee.pk/senior-audit-manager-transaction-banking-operations-karachi-jobs-1935862"
  },
  {
    "applyEmail": "",
    "applyLink": "https://www.mustakbil.com/jobs/job/1432313",
    "applyType": "portal",
    "city": "Karachi",
    "company": "AZEE Securities (Pvt. Ltd.)",
    "description": "Join the marketing and communications team of a Karachi capital-markets firm to create static/animated graphics and edit short- and long-form videos communicating the firm's research and brand across digital channels.",
    "field": "Design",
    "postingDate": "Not shown (found 2026-11-05)",
    "skills": [
      "Adobe Photoshop",
      "Adobe Illustrator",
      "Premiere Pro",
      "After Effects",
      "Motion Graphics"
    ],
    "title": "Graphic Designer & Video Editor",
    "workType": "On-site",
    "link": "https://www.mustakbil.com/jobs/job/1432313"
  },
  {
    "applyEmail": "careers@hijazhospital.org.pk",
    "applyLink": "https://www.pakvacancy.com/jobs/hijaz-teaching-hospital-lahore-jobs-2026",
    "applyType": "email",
    "city": "Lahore",
    "company": "Hijaz Teaching Hospital",
    "description": "Clinical Nursing Instructor position at Hijaz Teaching Hospital, Gulberg, Lahore (advertised in Jang, Nov 1, 2026); requires Post RN or BSN with Pakistan Nursing Council registration, and offers a market-competitive salary, free medical facility and provident fund.",
    "field": "Healthcare",
    "postingDate": "Nov 1, 2026",
    "skills": [
      "Nursing Education",
      "BSN / Post RN",
      "PNC Registration",
      "Clinical Training"
    ],
    "title": "Clinical Nursing Instructor",
    "workType": "On-site",
    "link": "https://www.pakvacancy.com/jobs/hijaz-teaching-hospital-lahore-jobs-2026"
  },
  {
    "applyEmail": "",
    "applyLink": "https://jobsleap.com/aga-khan-university-hospital-akuh-pakistan-jobs-2026/",
    "applyType": "portal",
    "city": "Karachi",
    "company": "Aga Khan University Hospital",
    "description": "Head Nurse role in Emergency Medicine at Aga Khan University Hospital, Karachi, part of AKUH's current advertised positions; applications are made online via the AKU careers portal, with this role closing 14 November 2026.",
    "field": "Healthcare",
    "postingDate": "Oct 31, 2026",
    "skills": [
      "Emergency Nursing",
      "Nursing Leadership",
      "Patient Care",
      "Team Management"
    ],
    "title": "Head Nurse, Emergency Medicine",
    "workType": "On-site",
    "link": "https://jobsleap.com/aga-khan-university-hospital-akuh-pakistan-jobs-2026/"
  },
  {
    "applyEmail": "",
    "applyLink": "https://parwaz.tech/pakistan-jobs/",
    "applyType": "portal",
    "city": "Karachi",
    "company": "National Bank of Pakistan",
    "description": "Manager Initiatives & Digital Learning (AVP) in Human Resource Management at National Bank of Pakistan, Karachi; a three-year contractual (renewable) role requiring a minimum of 6 years of experience, deadline 17 November 2026.",
    "field": "HR / Admin",
    "postingDate": "Nov 4, 2026",
    "skills": [
      "HR Management",
      "Digital Learning",
      "Training & Development"
    ],
    "title": "Manager Initiatives & Digital Learning (AVP)",
    "workType": "On-site",
    "link": "https://parwaz.tech/pakistan-jobs/"
  },
  {
    "applyEmail": "",
    "applyLink": "https://parwaz.tech/pakistan-jobs/",
    "applyType": "portal",
    "city": "Rajanpur",
    "company": "Islamic Relief Pakistan",
    "description": "Assistant People & Culture Officer position with Islamic Relief Pakistan based in Rajanpur; application deadline 9 November 2026.",
    "field": "HR / Admin",
    "postingDate": "Nov 4, 2026",
    "skills": [
      "HR Administration",
      "People & Culture",
      "Recruitment Support"
    ],
    "title": "Assistant People & Culture Officer",
    "workType": "On-site",
    "link": "https://parwaz.tech/pakistan-jobs/"
  },
  {
    "applyEmail": "",
    "applyLink": "https://parwaz.tech/pakistan-jobs/",
    "applyType": "portal",
    "city": "Islamabad",
    "company": "Allama Iqbal Open University",
    "description": "Allama Iqbal Open University, Islamabad invites online applications from Pakistani citizens for 15 teaching posts (Associate Professors and Lecturers) on a regular or contract basis across the Faculty of Sciences and Faculty of Social Sciences and Humanities; deadline 30 November 2026.",
    "field": "Education",
    "postingDate": "Nov 5, 2026",
    "skills": [
      "Teaching",
      "Research",
      "Subject Expertise"
    ],
    "title": "Associate Professors and Lecturers (15 Posts)",
    "workType": "On-site",
    "link": "https://parwaz.tech/pakistan-jobs/"
  },
  {
    "applyEmail": "",
    "applyLink": "https://pakjobbazar.com/human-rights-minorities-affairs-department-punjab-jobs-2026/",
    "applyType": "portal",
    "city": "Lahore",
    "company": "Human Rights & Minorities Affairs Department, Govt of Punjab",
    "description": "Project-based Content Writer (PPS-7) post in Lahore creating website content for the HR&MA Capacity Building & Human Rights Awareness project; requires BS/MA in English, Urdu or Mass Communication and Punjab domicile, with applications due by 13 November 2026. Salary shown on listing: Rs 207,900 per month.",
    "field": "Content",
    "postingDate": "Not shown (found 2026-11-05)",
    "skills": [
      "Content Writing",
      "English/Urdu Writing",
      "Mass Communication"
    ],
    "title": "Content Writer (PPS-7)",
    "workType": "On-site",
    "link": "https://pakjobbazar.com/human-rights-minorities-affairs-department-punjab-jobs-2026/"
  },
  {
    "applyEmail": "",
    "applyLink": "https://www.jobglobe.net/jobs/c795b64f-0b4c-4f59-9613-9bb5bbe08104/lahore-university-of-management-sciences-pakistan/warehouse-helper",
    "applyType": "portal",
    "city": "Lahore",
    "company": "Lahore University of Management Sciences",
    "description": "Warehouse Helper in LUMS Procurement department, Lahore, assisting the storekeeper with receiving, storing, issuing and organising materials and supplies; requires at least Intermediate in Commerce and knowledge of warehouse operations, with applications via the LUMS careers portal by 12 November 2026.",
    "field": "Logistics",
    "postingDate": "Nov 3, 2026",
    "skills": [
      "Warehouse Operations",
      "Inventory Handling",
      "Loading & Unloading",
      "Stock Organization"
    ],
    "title": "Warehouse Helper",
    "workType": "On-site",
    "link": "https://www.jobglobe.net/jobs/c795b64f-0b4c-4f59-9613-9bb5bbe08104/lahore-university-of-management-sciences-pakistan/warehouse-helper"
  }
];

function defaultSettings() {
  return {
    siteName: 'NexApply',
    googleClientId: '',
    googleClientSecret: '',
    smtpProduct: { email: '', appPassword: '' },
    smtpOwner: { email: '', appPassword: '' },
    smtpActive: 'product', // 'product' | 'owner'
    autoThreshold: 60,
    autoDailyCap: 10
  };
}
function loadDb() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      db.settings = Object.assign(defaultSettings(), db.settings || {});
      db.users = db.users || []; db.jobs = db.jobs || [];
      db.codes = db.codes || []; db.sessions = db.sessions || [];
      db.states = db.states || []; db.sendLog = db.sendLog || [];
      db.admin = db.admin || null;
      return db;
    } catch (e) { console.error('DB parse failed, starting fresh:', e.message); }
  }
  const db = {
    settings: defaultSettings(),
    admin: null,
    adminSetupCodeHash: null,
    users: [], jobs: [], codes: [], sessions: [], states: [], sendLog: []
  };
  for (const j of SEED_JOBS.concat(SEED_JOBS_MORE)) db.jobs.push(Object.assign({ id: uid(), active: true, createdAt: now() }, j));
  saveDb(db);
  return db;
}
let db = loadDb();
function saveDb(d) {
  d = d || db;
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d, null, 1));
  fs.renameSync(tmp, DB_FILE);
}

// One-time admin setup code, printed once per boot while no admin exists.
let adminSetupCodePlain = null;
if (!db.admin) {
  adminSetupCodePlain = String(Math.floor(100000 + Math.random() * 900000));
  db.adminSetupCodeHash = sha256(adminSetupCodePlain);
  saveDb();
  console.log('============================================================');
  console.log('  ADMIN SETUP REQUIRED — one-time admin setup code:');
  console.log('     >>>  ' + adminSetupCodePlain + '  <<<');
  console.log('  Open /admin in your browser and use this code to create');
  console.log('  the admin account. This code is shown only in this console.');
  console.log('============================================================');
}

// ------------------------------------------------------- skills dictionary
// canonical name -> synonyms (all matched case-insensitively)
const SKILLS = {
  // IT / software
  'HTML': ['html5'], 'CSS': ['css3'], 'JavaScript': ['javascript', 'js', 'ecmascript'],
  'TypeScript': ['typescript'], 'React': ['react', 'react.js', 'reactjs'],
  'Angular': ['angular'], 'Vue.js': ['vue', 'vue.js', 'vuejs'], 'Next.js': ['next.js', 'nextjs'],
  'Node.js': ['node.js', 'nodejs', 'node'], 'Express': ['express.js', 'expressjs'],
  'PHP': ['php'], 'Laravel': ['laravel'], 'WordPress': ['wordpress'],
  'Python': ['python'], 'Django': ['django'], 'Flask': ['flask'],
  'Java': ['java'], 'Spring': ['spring', 'spring boot'], 'C#': ['c#', 'csharp'],
  '.NET': ['.net', 'dotnet', 'asp.net'], 'C++': ['c++'], 'SQL': ['sql', 'mysql', 'mssql'],
  'MySQL': ['mysql'], 'PostgreSQL': ['postgresql', 'postgres'], 'MongoDB': ['mongodb', 'mongo'],
  'Git': ['git', 'github', 'gitlab'], 'REST API': ['rest api', 'restful', 'api integration'],
  'Responsive Design': ['responsive design', 'responsive'],
  'UI/UX Design': ['ui/ux', 'ui ux', 'ux design', 'ui design'],
  'Figma': ['figma'], 'Adobe Photoshop': ['photoshop', 'adobe photoshop'],
  'Adobe Illustrator': ['illustrator'], 'Graphic Design': ['graphic design', 'graphic designing'],
  'React Native': ['react native'], 'Flutter': ['flutter'], 'Android Development': ['android'],
  'iOS Development': ['ios', 'swift'], 'SEO': ['seo', 'search engine optimization'],
  'Performance Optimization': ['performance optimization', 'web performance'],
  'Testing': ['testing', 'qa', 'quality assurance', 'manual testing'],
  'DevOps': ['devops', 'ci/cd'], 'AWS': ['aws', 'amazon web services'], 'Linux': ['linux'],
  'Data Entry': ['data entry'], 'MS Excel': ['excel', 'ms excel', 'microsoft excel'],
  'MS Office': ['ms office', 'microsoft office', 'ms word'],
  // Accounting / finance
  'Accounting': ['accounting', 'accounts'], 'Bookkeeping': ['bookkeeping'],
  'QuickBooks': ['quickbooks'], 'Peachtree': ['peachtree', 'sage'],
  'Taxation': ['taxation', 'tax', 'income tax', 'sales tax'], 'Audit': ['audit', 'auditing'],
  'Financial Reporting': ['financial reporting', 'financial statements'],
  'Payroll': ['payroll'], 'Bank Reconciliation': ['bank reconciliation'],
  'Accounts Payable': ['accounts payable'], 'Accounts Receivable': ['accounts receivable'],
  'Budgeting': ['budgeting', 'budget'], 'ACCA': ['acca'], 'CA (Chartered Accountancy)': ['chartered accountancy'],
  // Sales / marketing
  'Sales': ['sales', 'selling'], 'B2B Sales': ['b2b sales', 'b2b'], 'B2C Sales': ['b2c sales', 'b2c'],
  'Telesales': ['telesales', 'tele sales'], 'Business Development': ['business development'],
  'Digital Marketing': ['digital marketing'], 'Social Media Marketing': ['social media marketing', 'social media'],
  'Content Writing': ['content writing', 'content writer'], 'Copywriting': ['copywriting'],
  'Email Marketing': ['email marketing'], 'Google Ads': ['google ads', 'adwords'],
  'Facebook Ads': ['facebook ads', 'meta ads'], 'Lead Generation': ['lead generation'],
  'Customer Relationship Management': ['crm', 'customer relationship management'],
  // HR / admin
  'Recruitment': ['recruitment', 'hiring', 'talent acquisition'],
  'HR Operations': ['hr operations', 'human resources', 'hr'],
  'Office Administration': ['office administration', 'administration', 'admin'],
  'Documentation': ['documentation', 'record keeping'], 'Typing': ['typing', 'typing speed'],
  'Communication Skills': ['communication skills', 'communication'],
  'English Fluency': ['english fluency', 'fluent english', 'english speaking'],
  // Customer support
  'Customer Support': ['customer support', 'customer service', 'customer care'],
  'Call Center': ['call center', 'call centre', 'bpo'], 'Live Chat Support': ['live chat', 'chat support'],
  'Complaint Handling': ['complaint handling'],
  // Engineering / technical trades
  'AutoCAD': ['autocad'], 'Electrical Engineering': ['electrical engineering', 'electrical'],
  'Mechanical Engineering': ['mechanical engineering', 'mechanical'],
  'Civil Engineering': ['civil engineering', 'civil'], 'Site Supervision': ['site supervision', 'site supervisor'],
  'PLC': ['plc'], 'Maintenance': ['maintenance', 'repair and maintenance'],
  'Quality Control': ['quality control', 'qc'], 'Production Planning': ['production planning'],
  // Teaching
  'Teaching': ['teaching', 'teacher', 'tutoring'], 'Lesson Planning': ['lesson planning'],
  'Classroom Management': ['classroom management'], 'Curriculum Development': ['curriculum'],
  // Medical
  'Nursing': ['nursing', 'nurse'], 'Patient Care': ['patient care'],
  'Pharmacy': ['pharmacy', 'pharmacist'], 'Medical Billing': ['medical billing'],
  'Lab Technology': ['lab technology', 'lab technician', 'mlt'],
  // Logistics / other
  'Supply Chain': ['supply chain'], 'Inventory Management': ['inventory management', 'inventory'],
  'Warehouse Management': ['warehouse'], 'Dispatch': ['dispatch'],
  'Driving': ['driving', 'driver'], 'Security Operations': ['security'],
  'Cooking': ['cooking', 'chef', 'cook'], 'Tailoring': ['tailoring', 'stitching'],
  'Data Analysis': ['data analysis', 'data analyst'], 'Power BI': ['power bi'],
  'Project Management': ['project management'], 'Team Leadership': ['team leadership', 'team lead', 'leadership']
};
function detectSkills(text) {
  const t = String(text || '').toLowerCase();
  const found = [];
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [name, syns] of Object.entries(SKILLS)) {
    const terms = [name.toLowerCase(), ...syns];
    for (const term of terms) {
      if (new RegExp('(^|[^a-z0-9])' + escRe(term) + '([^a-z0-9]|$)', 'i').test(t)) {
        found.push(name); break;
      }
    }
  }
  return found;
}

// ------------------------------------------------------------ text extract
function extractPdfText(buf) {
  const out = [];
  const s = buf.toString('latin1');
  let idx = 0;
  while (true) {
    const st = s.indexOf('stream', idx);
    if (st === -1) break;
    const en = s.indexOf('endstream', st);
    if (en === -1) break;
    let data = buf.slice(st + 6, en);
    if (data[0] === 0x0d && data[1] === 0x0a) data = data.slice(2);
    else if (data[0] === 0x0a || data[0] === 0x0d) data = data.slice(1);
    let text = null;
    try { text = zlib.inflateSync(data).toString('latin1'); } catch (e) { text = data.toString('latin1'); }
    if (text && (text.includes('BT') || text.includes('Tj') || text.includes('TJ'))) {
      const strs = text.match(/\((?:\\.|[^\\)])*\)/g) || [];
      for (const m of strs) out.push(m.slice(1, -1).replace(/\\([()\\])/g, '$1'));
      out.push(' ');
    }
    idx = en + 9;
  }
  return out.join(' ');
}
function extractDocxText(buf) {
  // minimal ZIP reader: find word/document.xml in local headers
  let xml = null;
  let off = 0;
  while (off < buf.length - 4) {
    if (buf.readUInt32LE(off) !== 0x04034b50) { off++; continue; }
    const method = buf.readUInt16LE(off + 8);
    const csize = buf.readUInt32LE(off + 18);
    const nlen = buf.readUInt16LE(off + 26);
    const elen = buf.readUInt16LE(off + 28);
    const name = buf.toString('utf8', off + 30, off + 30 + nlen);
    const dataStart = off + 30 + nlen + elen;
    if (name === 'word/document.xml') {
      const comp = buf.slice(dataStart, dataStart + csize);
      try { xml = method === 8 ? zlib.inflateRawSync(comp).toString('utf8') : comp.toString('utf8'); }
      catch (e) { xml = null; }
      break;
    }
    off = dataStart + (csize || 1);
    if (!csize) break;
  }
  if (!xml) return '';
  return xml.replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function extractText(buf, filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (ext === '.txt') return buf.toString('utf8');
  if (ext === '.pdf') return extractPdfText(buf);
  if (ext === '.docx') return extractDocxText(buf);
  return '';
}

// ------------------------------------------------------------ mail (SMTP)
function activeSmtp() {
  const st = db.settings;
  const slot = st.smtpActive === 'owner' ? st.smtpOwner : st.smtpProduct;
  return slot;
}
function smtpConfigured() {
  const s = activeSmtp();
  return Boolean(nodemailer && s && s.email && s.appPassword);
}
async function sendSiteEmail(to, subject, text) {
  if (!smtpConfigured()) return { devMode: true };
  const s = activeSmtp();
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: s.email, pass: String(s.appPassword).replace(/\s+/g, '') }
  });
  await transporter.sendMail({
    from: '"' + db.settings.siteName + '" <' + s.email + '>',
    to, subject, text
  });
  return { sent: true };
}

// ------------------------------------------------------- verification codes
const CODE_TTL = 10 * 60 * 1000, CODE_MAX_ATTEMPTS = 5, CODE_COOLDOWN = 60 * 1000;
function getCode(email) { return db.codes.find(c => c.email === email); }
async function requestCode(email, pending) {
  const existing = getCode(email);
  if (existing && now() - existing.lastSentAt < CODE_COOLDOWN) {
    return { error: 'Please wait 60 seconds before asking for a new code.', cooldown: true };
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const rec = { email, codeHash: sha256(code), expiresAt: now() + CODE_TTL, attempts: 0, lastSentAt: now(), pending: pending || null };
  db.codes = db.codes.filter(c => c.email !== email);
  db.codes.push(rec); saveDb();
  const siteName = db.settings.siteName;
  let res;
  try {
    res = await sendSiteEmail(email, siteName + ' — your verification code',
      'Your ' + siteName + ' verification code is: ' + code + '\n\nIt expires in 10 minutes. If you did not request this, ignore this email.');
  } catch (e) {
    db.codes = db.codes.filter(c => c.email !== email); saveDb();
    console.error('Verification email failed for ' + email + ':', e.message);
    return { error: 'We could not send the verification email right now. Please try again later.' };
  }
  if (res.devMode) {
    console.log('============================================================');
    console.log('  [DEMO MODE — no SMTP configured] Verification code');
    console.log('  Email: ' + email);
    console.log('  Code : ' + code);
    console.log('============================================================');
  }
  return { ok: true, devMode: Boolean(res.devMode) };
}
function verifyCode(email, code) {
  const rec = getCode(email);
  if (!rec) return { error: 'No code was sent to this email. Please request a code first.' };
  if (now() > rec.expiresAt) {
    db.codes = db.codes.filter(c => c.email !== email); saveDb();
    return { error: 'This code has expired. Please request a new code.', expired: true };
  }
  if (rec.attempts >= CODE_MAX_ATTEMPTS) {
    return { error: 'Too many wrong attempts. Please request a new code.', locked: true };
  }
  if (sha256(String(code).trim()) !== rec.codeHash) {
    rec.attempts++; saveDb();
    return { error: 'Wrong code. ' + Math.max(0, CODE_MAX_ATTEMPTS - rec.attempts) + ' attempts left.' };
  }
  const pending = rec.pending || null;
  db.codes = db.codes.filter(c => c.email !== email); saveDb();
  return { ok: true, pending };
}

// ---------------------------------------------------------------- sessions
function createSession(userId, role) {
  const token = randToken(32);
  db.sessions.push({ tokenHash: sha256(token), userId, role, createdAt: now(), expiresAt: now() + 30 * 24 * 3600 * 1000 });
  saveDb();
  return token;
}
function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies.rm_session;
  if (!token) return null;
  const s = db.sessions.find(x => x.tokenHash === sha256(token));
  if (!s || now() > s.expiresAt) return null;
  return s;
}
function destroySession(req) {
  const cookies = parseCookies(req);
  if (cookies.rm_session) {
    db.sessions = db.sessions.filter(x => x.tokenHash !== sha256(cookies.rm_session));
    saveDb();
  }
}
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function sessionCookie(token) {
  return 'rm_session=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (30 * 24 * 3600);
}
function clearCookie() { return 'rm_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'; }

// ------------------------------------------------------------------ users
function findUserByEmail(email) { return db.users.find(u => u.email === email); }
function findUser(id) { return db.users.find(u => u.id === id); }
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, email: u.email, name: u.name || '', firstName: u.firstName || '', lastName: u.lastName || '', city: u.city || '', phone: u.phone || '',
    skills: u.skills || [],
    preferences: u.preferences || { roles: [], locations: [], workTypes: [] },
    cv: u.cv ? { fileName: u.cv.fileName, uploadedAt: u.cv.uploadedAt } : null,
    autoApply: Boolean(u.autoApply && u.autoApply.on),
    autoApplyNeedsAttention: Boolean(u.autoApplyNeedsAttention),
    googleConnected: isGoogleConnected(u),
    googleEmail: u.google && u.google.email ? u.google.email : null,
    signupAt: u.createdAt
  };
}
function isGoogleConnected(u) {
  if (DEMO_GOOGLE) return Boolean(u.google && u.google.demoConnected);
  return Boolean(u.google && u.google.refreshToken);
}

// --------------------------------------------------------------- matching
function computeMatch(user, job) {
  // No CV / no skills on file yet — there is nothing to match against,
  // so no match score is shown at all (owner's rule, 2026-11-05).
  if (!user.skills || !user.skills.length) return null;
  const userSkills = (user.skills || []).map(s => s.toLowerCase());
  const jobSkills = (job.skills || []);
  let score = 0;
  if (jobSkills.length) {
    const have = jobSkills.filter(s => userSkills.includes(s.toLowerCase())).length;
    score += Math.round(70 * (have / jobSkills.length));
  } else {
    score += 35; // no skills listed — neutral base
  }
  const prefs = user.preferences || { roles: [], locations: [], workTypes: [] };
  const locs = (prefs.locations || []).map(s => s.toLowerCase());
  if (!locs.length || locs.includes('anywhere in pakistan') ||
      locs.includes(String(job.city).toLowerCase()) ||
      (job.workType === 'Remote' && locs.includes('remote'))) score += 10;
  const title = (job.title + ' ' + (job.field || '')).toLowerCase();
  const roles = prefs.roles || [];
  if (roles.length) {
    let bonus = 0;
    for (const r of roles) {
      const words = String(r).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
      if (words.some(w => title.includes(w))) bonus = 20;
    }
    score += bonus;
  } else score += 10;
  if ((prefs.workTypes || []).length && (prefs.workTypes || []).includes(job.workType)) score += 0; // shown, not weighted
  return Math.max(0, Math.min(100, score));
}

// ------------------------------------------------------------ cover letter
function buildCoverLetter(user, job) {
  const name = user.name || user.email;
  const matched = (job.skills || []).filter(s => (user.skills || []).map(x => x.toLowerCase()).includes(s.toLowerCase()));
  const skillLine = matched.length ? matched.join(', ') : (user.skills || []).slice(0, 6).join(', ');
  return [
    'Dear Hiring Team at ' + job.company + ',',
    '',
    'I am writing to apply for the position of ' + job.title + ', advertised in ' + job.city + '.',
    skillLine ? 'My relevant skills include: ' + skillLine + '.' : '',
    'My CV is attached with this email for your review. I would welcome the opportunity to discuss how my experience fits your requirements.',
    '',
    'Thank you for your time and consideration.',
    '',
    'Regards,',
    name,
    user.city ? user.city + ', Pakistan' : 'Pakistan',
    user.phone ? 'Phone: ' + user.phone : '',
    'Email: ' + user.email
  ].filter(l => l !== '').join('\n');
}

// ------------------------------------------------------- Gmail API sending
async function googleAccessToken(user) {
  const st = db.settings;
  const body = new URLSearchParams({
    client_id: st.googleClientId, client_secret: st.googleClientSecret,
    refresh_token: user.google.refreshToken, grant_type: 'refresh_token'
  });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error('Google token refresh failed: ' + (j.error || r.status));
  return j.access_token;
}
function mimeMessage({ from, to, subject, text, replyTo, attachment }) {
  const boundary = 'rm_' + randToken(8);
  const lines = [];
  lines.push('From: ' + from);
  lines.push('To: ' + to);
  if (replyTo) lines.push('Reply-To: ' + replyTo);
  lines.push('Subject: ' + subject);
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: multipart/mixed; boundary="' + boundary + '"');
  lines.push('');
  lines.push('--' + boundary);
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('');
  lines.push(text);
  if (attachment) {
    lines.push('--' + boundary);
    lines.push('Content-Type: ' + attachment.mime + '; name="' + attachment.name + '"');
    lines.push('Content-Disposition: attachment; filename="' + attachment.name + '"');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(attachment.data.toString('base64').replace(/(.{76})/g, '$1\r\n'));
  }
  lines.push('--' + boundary + '--');
  return lines.join('\r\n');
}
async function sendFromUserGmail(user, job) {
  // Returns {ok} or throws. In DEMO mode, writes to outbox instead.
  const subject = 'Application for ' + job.title + ' — ' + (user.name || user.email);
  const letter = buildCoverLetter(user, job);
  let attachment = null;
  if (user.cv && user.cv.filePath && fs.existsSync(user.cv.filePath)) {
    attachment = {
      name: user.cv.fileName || 'CV.pdf',
      mime: user.cv.fileName && user.cv.fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf'
        : user.cv.fileName && user.cv.fileName.toLowerCase().endsWith('.docx')
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain',
      data: fs.readFileSync(user.cv.filePath)
    };
  }
  if (DEMO_GOOGLE) {
    const entry = {
      demo: true, at: new Date().toISOString(), from: user.email, to: job.applyEmail,
      subject, jobId: job.id, jobTitle: job.title, company: job.company,
      cvAttached: Boolean(attachment), coverLetter: letter
    };
    fs.appendFileSync(OUTBOX_FILE, JSON.stringify(entry) + '\n');
    return { ok: true, demo: true };
  }
  const accessToken = await googleAccessToken(user);
  const raw = mimeMessage({ from: user.email, to: job.applyEmail, subject, text: letter, replyTo: user.email, attachment });
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(raw).toString('base64url') })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Gmail send failed: ' + ((j.error && j.error.message) || r.status));
  return { ok: true, messageId: j.id };
}

// ------------------------------------------------------------- auto-apply
function getState(userId, jobId) { return db.states.find(s => s.userId === userId && s.jobId === jobId); }
function setState(userId, jobId, patch) {
  let s = getState(userId, jobId);
  if (!s) { s = { userId, jobId, status: null }; db.states.push(s); }
  Object.assign(s, patch);
  return s;
}
function sentTodayCount(userId) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  return db.sendLog.filter(l => l.userId === userId && l.at >= start.getTime()).length;
}
let engineRunning = false;
async function runAutoApply(reason) {
  if (engineRunning) return { skipped: 'already running' };
  engineRunning = true;
  const results = { reason: reason || 'timer', sent: 0, checkedUsers: 0, errors: [] };
  try {
    const threshold = Number(db.settings.autoThreshold) || 60;
    const cap = Number(db.settings.autoDailyCap) || 10;
    const emailJobs = db.jobs.filter(j => j.active && j.applyType === 'email' && j.applyEmail);
    for (const user of db.users) {
      if (!user.autoApply || !user.autoApply.on) continue;
      if (user.autoApplyNeedsAttention) continue;
      if (!isGoogleConnected(user)) continue;
      if (!user.cv || !user.cv.filePath) continue;
      results.checkedUsers++;
      let sentToday = sentTodayCount(user.id);
      const candidates = emailJobs
        .map(j => ({ job: j, match: computeMatch(user, j) }))
        .filter(x => x.match >= threshold)
        .sort((a, b) => (b.match ?? -1) - (a.match ?? -1));
      for (const { job, match } of candidates) {
        if (sentToday >= cap) break;
        const st = getState(user.id, job.id);
        if (st && st.status === 'applied') continue; // NEVER send twice
        try {
          await sendFromUserGmail(user, job);
          setState(user.id, job.id, {
            status: 'applied', method: 'Auto', appliedAt: now(), appliedDate: isoToday(), match
          });
          db.sendLog.push({ userId: user.id, jobId: job.id, at: now(), method: 'Auto', to: job.applyEmail });
          saveDb();
          results.sent++; sentToday++;
        } catch (e) {
          results.errors.push({ user: user.email, job: job.title, error: e.message });
          if (!DEMO_GOOGLE) {
            user.autoApplyNeedsAttention = true; saveDb();
          }
          break; // stop trying for this user until fixed
        }
      }
    }
  } finally {
    engineRunning = false;
    saveDb();
  }
  return results;
}
setInterval(() => { runAutoApply('timer').catch(e => console.error('auto-apply:', e.message)); }, 15 * 60 * 1000);

// ------------------------------------------------------------ http helpers
function sendJson(res, code, obj, headers) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers || {}));
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 8 * 1024 * 1024) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch (e) { return {}; }
}
function parseMultipart(buf, boundary) {
  const parts = [];
  const delim = Buffer.from('--' + boundary);
  let start = buf.indexOf(delim);
  while (start !== -1) {
    let headerEnd = buf.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const header = buf.toString('utf8', start, headerEnd);
    const dataStart = headerEnd + 4;
    let next = buf.indexOf(delim, dataStart);
    if (next === -1) break;
    let dataEnd = next - 2; // strip trailing CRLF
    if (dataEnd < dataStart) dataEnd = dataStart;
    const nameM = header.match(/name="([^"]+)"/);
    const fileM = header.match(/filename="([^"]*)"/);
    parts.push({
      name: nameM ? nameM[1] : '',
      filename: fileM ? fileM[1] : null,
      data: buf.slice(dataStart, dataEnd)
    });
    start = next;
    // "--" after delimiter = end
    if (buf[start + delim.length] === 0x2d && buf[start + delim.length + 1] === 0x2d) break;
  }
  return parts;
}
function requireUser(req, res) {
  const s = getSession(req);
  if (!s || s.role !== 'user') { sendJson(res, 401, { error: 'Please log in first.' }); return null; }
  const u = findUser(s.userId);
  if (!u) { sendJson(res, 401, { error: 'Account not found.' }); return null; }
  return u;
}
function requireAdmin(req, res) {
  const s = getSession(req);
  if (!s || s.role !== 'admin') { sendJson(res, 401, { error: 'Admin login required.' }); return null; }
  return s;
}
function jobForUser(user, job) {
  const st = getState(user.id, job.id);
  // "Related to my CV": the user has at least one of the job's listed skills
  // (a job with no listed skills counts as related). No skills on file = not related.
  const uSk = (user.skills || []).map(s => String(s).toLowerCase());
  const jSk = (job.skills || []).map(s => String(s).toLowerCase());
  const related = uSk.length > 0 && (jSk.length === 0 || jSk.some(s => uSk.includes(s)));
  return {
    id: job.id, title: job.title, company: job.company, city: job.city,
    workType: job.workType, field: job.field || '', skills: job.skills || [],
    applyType: job.applyType, applyEmail: job.applyType === 'email' ? job.applyEmail : undefined,
    applyLink: job.applyLink || job.link || '',
    postingDate: job.postingDate || '', description: job.description || '',
    match: computeMatch(user, job), related,
    state: st ? st.status : null,
    stateMethod: st ? (st.method || null) : null,
    appliedDate: st ? (st.appliedDate || null) : null
  };
}

// ------------------------------------------------------------------- OAuth
function googleConfigured() {
  return Boolean(db.settings.googleClientId && db.settings.googleClientSecret);
}
function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return proto + '://' + req.headers.host;
}
async function handleGoogleCallback(req, res, url) {
  const err = (msg) => {
    res.writeHead(302, { Location: '/?googleError=' + encodeURIComponent(msg) });
    res.end();
  };
  const s = getSession(req);
  if (!s || s.role !== 'user') return err('Please log in first, then connect Google.');
  const user = findUser(s.userId);
  if (!user) return err('Account not found.');
  const code = url.searchParams.get('code');
  if (!code) return err('Google did not return a code.');
  try {
    const body = new URLSearchParams({
      code, client_id: db.settings.googleClientId, client_secret: db.settings.googleClientSecret,
      redirect_uri: baseUrl(req) + '/api/auth/google/callback', grant_type: 'authorization_code'
    });
    const tr = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
    const tj = await tr.json();
    if (!tr.ok || !tj.access_token) return err('Could not complete Google sign-in. Please try again.');
    const ui = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: 'Bearer ' + tj.access_token }
    });
    const uj = await ui.json();
    const googleEmail = normEmail(uj.email);
    if (!googleEmail) return err('Could not read your Google email.');
    if (googleEmail !== user.email) {
      return err('That Google account (' + googleEmail + ') is not the email of this account (' + user.email + '). Please connect the Google account with the same email you signed up with.');
    }
    if (!tj.refresh_token) {
      // Google only returns a refresh token on consent; prompt=consent is set, but guard anyway.
      return err('Google did not grant offline access. Please disconnect the app in your Google account permissions and connect again.');
    }
    user.google = { email: googleEmail, refreshToken: tj.refresh_token, connectedAt: now() };
    user.autoApplyNeedsAttention = false;
    saveDb();
    res.writeHead(302, { Location: '/?googleConnected=1' });
    res.end();
  } catch (e) {
    return err('Google connection failed: ' + e.message);
  }
}

// -------------------------------------------------------------------- API
async function handleApi(req, res, url) {
  const p = url.pathname;

  if (p === '/api/config' && req.method === 'GET') {
    return sendJson(res, 200, {
      siteName: db.settings.siteName,
      demoMode: !smtpConfigured(),
      demoGoogle: DEMO_GOOGLE,
      googleConfigured: googleConfigured(),
      signupNotice: 'Use the email you want your job applications sent from. When email applications are sent for you, they will be sent from this email address.'
    });
  }

  // ---- user auth (sign up with name + email + password, verify email once
  // with a code, then log in with email + password — owner's flow, 2026-11-05)
  if (p === '/api/auth/signup' && req.method === 'POST') {
    const b = await readJson(req);
    const email = normEmail(b.email);
    const firstName = String(b.firstName || '').trim().slice(0, 60);
    const lastName = String(b.lastName || '').trim().slice(0, 60);
    const password = String(b.password || '');
    if (!firstName || !lastName) return sendJson(res, 400, { error: 'Please enter your first and last name.' });
    if (!validEmail(email)) return sendJson(res, 400, { error: 'Please enter a valid email address.' });
    if (password.length < 8) return sendJson(res, 400, { error: 'Password must be at least 8 characters.' });
    if (findUserByEmail(email)) return sendJson(res, 400, { error: 'This account is already created. Please log in instead.' });
    const r = await requestCode(email, { firstName, lastName, passwordHash: scryptHash(password) });
    if (r.error) return sendJson(res, r.cooldown ? 429 : 400, r);
    return sendJson(res, 200, r);
  }
  if (p === '/api/auth/signup/verify' && req.method === 'POST') {
    const body = await readJson(req);
    const email = normEmail(body.email);
    if (!validEmail(email)) return sendJson(res, 400, { error: 'Please enter a valid email address.' });
    const r = verifyCode(email, body.code || '');
    if (!r.ok) return sendJson(res, 400, r);
    if (!r.pending) return sendJson(res, 400, { error: 'Please fill the sign up form first, so we know your name and password.' });
    if (findUserByEmail(email)) return sendJson(res, 400, { error: 'This account is already created. Please log in instead.' });
    const user = {
      id: uid(), email,
      firstName: r.pending.firstName, lastName: r.pending.lastName,
      name: (r.pending.firstName + ' ' + r.pending.lastName).trim(),
      passwordHash: r.pending.passwordHash,
      city: '', phone: '',
      skills: [], skillSource: null,
      preferences: { roles: [], locations: [], workTypes: [] },
      cv: null, google: null, autoApply: { on: false, consentAt: null },
      autoApplyNeedsAttention: false, createdAt: now()
    };
    db.users.push(user); saveDb();
    const token = createSession(user.id, 'user');
    return sendJson(res, 200, { ok: true, isNew: true, user: publicUser(user) }, { 'Set-Cookie': sessionCookie(token) });
  }
  if (p === '/api/auth/login' && req.method === 'POST') {
    const b = await readJson(req);
    const email = normEmail(b.email);
    if (!validEmail(email)) return sendJson(res, 400, { error: 'Please enter a valid email address.' });
    const user = findUserByEmail(email);
    if (!user) return sendJson(res, 404, { error: 'This account is not created. Please sign up first.' });
    if (!user.passwordHash) return sendJson(res, 400, { error: 'This account was created before passwords were added. Please sign up again with a password.' });
    if (!scryptVerify(b.password || '', user.passwordHash)) return sendJson(res, 401, { error: 'Incorrect password. Please try again.' });
    const token = createSession(user.id, 'user');
    return sendJson(res, 200, { ok: true, user: publicUser(user) }, { 'Set-Cookie': sessionCookie(token) });
  }
  if (p === '/api/auth/logout' && req.method === 'POST') {
    destroySession(req);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearCookie() });
  }
  if (p === '/api/auth/google/callback' && req.method === 'GET') {
    return handleGoogleCallback(req, res, url);
  }

  // ---- user area
  if (p.startsWith('/api/me')) {
    const user = requireUser(req, res);
    if (!user) return;

    if (p === '/api/me' && req.method === 'GET') return sendJson(res, 200, { user: publicUser(user) });

    if (p === '/api/me/profile' && req.method === 'PUT') {
      const b = await readJson(req);
      user.name = String(b.name || '').slice(0, 80);
      user.city = String(b.city || '').slice(0, 60);
      user.phone = String(b.phone || '').slice(0, 30);
      saveDb();
      return sendJson(res, 200, { user: publicUser(user) });
    }
    if (p === '/api/me/skills' && req.method === 'PUT') {
      const b = await readJson(req);
      const skills = Array.isArray(b.skills) ? b.skills.map(s => String(s).slice(0, 40)).filter(Boolean) : [];
      user.skills = [...new Set(skills)].slice(0, 60);
      // remember which of these were added by hand (not from the CV) so removing the CV keeps them
      user.skillsManual = user.skills.filter(s => !(user.cvSkills || []).includes(s));
      saveDb();
      return sendJson(res, 200, { user: publicUser(user) });
    }
    if (p === '/api/me/preferences' && req.method === 'PUT') {
      const b = await readJson(req);
      user.preferences = {
        roles: (b.roles || []).map(s => String(s).slice(0, 60)).filter(Boolean).slice(0, 15),
        locations: (b.locations || []).map(s => String(s).slice(0, 40)).filter(Boolean).slice(0, 25),
        workTypes: (b.workTypes || []).filter(w => ['On-site', 'Hybrid', 'Remote'].includes(w))
      };
      saveDb();
      return sendJson(res, 200, { user: publicUser(user) });
    }
    if (p === '/api/me/autoapply' && req.method === 'PUT') {
      const b = await readJson(req);
      if (b.on) {
        if (!isGoogleConnected(user)) {
          return sendJson(res, 400, { error: 'Please connect your Google account first — auto-apply sends emails from your own email address.' });
        }
        if (!b.consent) {
          return sendJson(res, 400, { error: 'Please accept the consent line to turn auto-apply on.' });
        }
        user.autoApply = { on: true, consentAt: now() };
        user.autoApplyNeedsAttention = false;
      } else {
        user.autoApply = { on: false, consentAt: user.autoApply ? user.autoApply.consentAt : null };
      }
      saveDb();
      if (b.on) runAutoApply('toggle-on').catch(e => console.error('auto-apply:', e.message));
      return sendJson(res, 200, { user: publicUser(user) });
    }
    if (p === '/api/me/google/connect' && req.method === 'GET') {
      if (DEMO_GOOGLE) {
        user.google = { email: user.email, demoConnected: true, connectedAt: now() };
        user.autoApplyNeedsAttention = false; saveDb();
        res.writeHead(302, { Location: '/?googleConnected=1' }); return res.end();
      }
      if (!googleConfigured()) return sendJson(res, 400, { error: 'Google connect is not set up yet. Please check back later.' });
      const params = new URLSearchParams({
        client_id: db.settings.googleClientId,
        redirect_uri: baseUrl(req) + '/api/auth/google/callback',
        response_type: 'code',
        scope: 'openid email https://www.googleapis.com/auth/gmail.send',
        access_type: 'offline', prompt: 'consent', login_hint: user.email
      });
      res.writeHead(302, { Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString() });
      return res.end();
    }
    if (p === '/api/me/google/disconnect' && req.method === 'POST') {
      user.google = null;
      if (user.autoApply) user.autoApply.on = false;
      saveDb();
      return sendJson(res, 200, { user: publicUser(user) });
    }
    if (p === '/api/me/cv' && req.method === 'POST') {
      const ct = req.headers['content-type'] || '';
      const m = ct.match(/boundary=(.+)$/);
      if (!m) return sendJson(res, 400, { error: 'Invalid upload.' });
      const buf = await readBody(req);
      const parts = parseMultipart(buf, m[1].replace(/"/g, ''));
      const file = parts.find(x => x.filename);
      if (!file || !file.data.length) return sendJson(res, 400, { error: 'No file received.' });
      const ext = path.extname(file.filename).toLowerCase();
      if (!['.pdf', '.docx', '.txt'].includes(ext)) {
        return sendJson(res, 400, { error: 'Only PDF, DOCX or TXT files are allowed.' });
      }
      if (file.data.length > 5 * 1024 * 1024) {
        return sendJson(res, 400, { error: 'CV file is too large. Maximum size is 5 MB.' });
      }
      if (user.cv && user.cv.filePath && fs.existsSync(user.cv.filePath)) {
        try { fs.unlinkSync(user.cv.filePath); } catch (e) {}
      }
      const safeName = 'cv_' + user.id + '_' + Date.now() + ext;
      const filePath = path.join(UPLOAD_DIR, safeName);
      fs.writeFileSync(filePath, file.data);
      const text = extractText(file.data, file.filename);
      const detected = detectSkills(text);
      user.cv = { fileName: file.filename, filePath, uploadedAt: now(), textLength: text.length };
      // merge detected skills with any manually added later — on upload, CV skills become the base
      user.skills = [...new Set([...(user.skillsManual || []), ...detected])];
      user.cvSkills = detected;
      saveDb();
      return sendJson(res, 200, { user: publicUser(user), detectedSkills: detected, textLength: text.length });
    }
    if (p === '/api/me/cv' && req.method === 'DELETE') {
      if (user.cv && user.cv.filePath && fs.existsSync(user.cv.filePath)) {
        try { fs.unlinkSync(user.cv.filePath); } catch (e) {}
      }
      user.cv = null; user.cvSkills = [];
      user.skills = [...(user.skillsManual || [])];
      saveDb();
      return sendJson(res, 200, { user: publicUser(user) });
    }
    if (p === '/api/me/applications' && req.method === 'GET') {
      const apps = db.states.filter(s => s.userId === user.id && s.status)
        .map(s => {
          const job = db.jobs.find(j => j.id === s.jobId);
          if (!job) return null;
          return {
            jobId: job.id, title: job.title, company: job.company, city: job.city,
            status: s.status, method: s.method || null, appliedDate: s.appliedDate || null,
            appliedAt: s.appliedAt || null, applyType: job.applyType
          };
        }).filter(Boolean)
        .sort((a, b) => (b.appliedAt || 0) - (a.appliedAt || 0));
      return sendJson(res, 200, { applications: apps });
    }
    return sendJson(res, 404, { error: 'Not found.' });
  }

  // ---- jobs (user view)
  if (p === '/api/jobs' && req.method === 'GET') {
    const user = requireUser(req, res); if (!user) return;
    let pool = db.jobs.filter(j => j.active);
    let jobs;
    if (!user.skills || !user.skills.length) {
      // No CV yet: show every job added in the last 5 days, newest first
      // (owner's rule, 2026-11-05). Jobs without a stored date count as fresh.
      const cutoff = now() - 5 * 24 * 3600 * 1000;
      jobs = pool.filter(j => !j.createdAt || j.createdAt >= cutoff)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .map(j => jobForUser(user, j));
    } else {
      jobs = pool.map(j => jobForUser(user, j))
        .sort((a, b) => (b.match ?? -1) - (a.match ?? -1));
    }
    return sendJson(res, 200, { jobs });
  }
  const jobMatch = p.match(/^\/api\/jobs\/([a-z0-9]+)(\/state|\/apply-email)?$/);
  if (jobMatch) {
    const user = requireUser(req, res); if (!user) return;
    const job = db.jobs.find(j => j.id === jobMatch[1] && j.active);
    if (!job) return sendJson(res, 404, { error: 'Job not found.' });
    const sub = jobMatch[2] || '';
    if (!sub && req.method === 'GET') {
      const detail = jobForUser(user, job);
      const userSkillsLower = (user.skills || []).map(s => s.toLowerCase());
      detail.haveSkills = (job.skills || []).filter(s => userSkillsLower.includes(s.toLowerCase()));
      detail.missingSkills = (job.skills || []).filter(s => !userSkillsLower.includes(s.toLowerCase()));
      detail.coverLetter = job.applyType === 'email' ? buildCoverLetter(user, job) : null;
      return sendJson(res, 200, { job: detail });
    }
    if (sub === '/state' && req.method === 'POST') {
      const b = await readJson(req);
      const state = ['saved', 'applied', 'skipped', null].includes(b.state) ? b.state : undefined;
      if (state === undefined) return sendJson(res, 400, { error: 'Invalid state.' });
      const existing = getState(user.id, job.id);
      if (existing && existing.status === 'applied') {
        return sendJson(res, 400, { error: 'You have already applied to this job. An application is final and cannot be changed or sent twice.' });
      }
      if (state === 'applied') {
        setState(user.id, job.id, { status: 'applied', method: 'Manual', appliedAt: now(), appliedDate: isoToday() });
      } else if (state === null) {
        setState(user.id, job.id, { status: null, method: null, appliedAt: null, appliedDate: null });
      } else {
        setState(user.id, job.id, { status: state });
      }
      saveDb();
      return sendJson(res, 200, { job: jobForUser(user, job) });
    }
    if (sub === '/apply-email' && req.method === 'POST') {
      if (job.applyType !== 'email') return sendJson(res, 400, { error: 'This job is not an email-apply job.' });
      const existing = getState(user.id, job.id);
      if (existing && existing.status === 'applied') {
        return sendJson(res, 400, { error: 'You have already applied to this job. Applications are never sent twice.' });
      }
      if (!isGoogleConnected(user)) {
        return sendJson(res, 200, {
          connected: false, applyEmail: job.applyEmail,
          coverLetter: buildCoverLetter(user, job),
          message: 'Connect your Google account to apply in one click from your own email — or send this email yourself with your CV attached.'
        });
      }
      if (!user.cv) return sendJson(res, 400, { error: 'Please upload your CV first.' });
      try {
        await sendFromUserGmail(user, job);
        setState(user.id, job.id, { status: 'applied', method: 'Manual', appliedAt: now(), appliedDate: isoToday() });
        db.sendLog.push({ userId: user.id, jobId: job.id, at: now(), method: 'Manual', to: job.applyEmail });
        saveDb();
        return sendJson(res, 200, { connected: true, sent: true, job: jobForUser(user, job) });
      } catch (e) {
        return sendJson(res, 502, { error: 'Sending failed: ' + e.message });
      }
    }
  }

  // ---- admin
  if (p.startsWith('/api/admin')) return handleAdmin(req, res, url, p);

  return sendJson(res, 404, { error: 'Not found.' });
}

async function handleAdmin(req, res, url, p) {
  if (p === '/api/admin/status' && req.method === 'GET') {
    const s = getSession(req);
    return sendJson(res, 200, { needsSetup: !db.admin, loggedIn: Boolean(s && s.role === 'admin') });
  }
  if (p === '/api/admin/setup' && req.method === 'POST') {
    if (db.admin) return sendJson(res, 400, { error: 'Admin account already exists.' });
    const b = await readJson(req);
    if (!adminSetupCodePlain || sha256(String(b.code || '')) !== db.adminSetupCodeHash) {
      return sendJson(res, 400, { error: 'Wrong setup code. Check the server console for the one-time code.' });
    }
    const email = normEmail(b.email);
    if (!validEmail(email)) return sendJson(res, 400, { error: 'Please enter a valid admin email.' });
    if (!b.password || String(b.password).length < 8) {
      return sendJson(res, 400, { error: 'Password must be at least 8 characters.' });
    }
    db.admin = { email, passwordHash: scryptHash(b.password), createdAt: now() };
    db.adminSetupCodeHash = null; adminSetupCodePlain = null;
    saveDb();
    const token = createSession('admin', 'admin');
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(token) });
  }
  if (p === '/api/admin/login' && req.method === 'POST') {
    const b = await readJson(req);
    if (!db.admin) return sendJson(res, 400, { error: 'No admin account yet. Setup is required.' });
    if (normEmail(b.email) !== db.admin.email || !scryptVerify(b.password || '', db.admin.passwordHash)) {
      return sendJson(res, 401, { error: 'Wrong email or password.' });
    }
    const token = createSession('admin', 'admin');
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(token) });
  }
  if (p === '/api/admin/logout' && req.method === 'POST') {
    destroySession(req);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearCookie() });
  }

  const sess = requireAdmin(req, res); if (!sess) return;

  if (p === '/api/admin/stats' && req.method === 'GET') {
    return sendJson(res, 200, {
      users: db.users.length,
      jobs: db.jobs.length,
      activeJobs: db.jobs.filter(j => j.active).length,
      applications: db.states.filter(s => s.status === 'applied').length,
      emailsSent: db.sendLog.length,
      autoApplyUsers: db.users.filter(u => u.autoApply && u.autoApply.on).length,
      smtpConfigured: smtpConfigured(),
      googleConfigured: googleConfigured()
    });
  }
  if (p === '/api/admin/jobs' && req.method === 'GET') {
    return sendJson(res, 200, { jobs: db.jobs });
  }
  if (p === '/api/admin/jobs' && req.method === 'POST') {
    const b = await readJson(req);
    const job = sanitizeJob(b, { id: uid(), createdAt: now() });
    if (job.error) return sendJson(res, 400, { error: job.error });
    db.jobs.push(job); saveDb();
    runAutoApply('new-job').catch(e => console.error('auto-apply:', e.message));
    return sendJson(res, 200, { job });
  }
  const jm = p.match(/^\/api\/admin\/jobs\/([a-z0-9]+)$/);
  if (jm && req.method === 'PUT') {
    const idx = db.jobs.findIndex(j => j.id === jm[1]);
    if (idx === -1) return sendJson(res, 404, { error: 'Job not found.' });
    const b = await readJson(req);
    const job = sanitizeJob(b, db.jobs[idx]);
    if (job.error) return sendJson(res, 400, { error: job.error });
    db.jobs[idx] = job; saveDb();
    return sendJson(res, 200, { job });
  }
  if (jm && req.method === 'DELETE') {
    db.jobs = db.jobs.filter(j => j.id !== jm[1]);
    saveDb();
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/admin/users' && req.method === 'GET') {
    const users = db.users.map(u => ({
      id: u.id, email: u.email, name: u.name || '', city: u.city || '',
      signupAt: u.createdAt, hasCv: Boolean(u.cv),
      autoApply: Boolean(u.autoApply && u.autoApply.on),
      googleConnected: isGoogleConnected(u),
      applications: db.states.filter(s => s.userId === u.id && s.status === 'applied').length
    }));
    return sendJson(res, 200, { users });
  }
  if (p === '/api/admin/settings' && req.method === 'GET') {
    const st = db.settings;
    return sendJson(res, 200, {
      settings: {
        siteName: st.siteName,
        googleClientId: st.googleClientId,
        googleClientSecretSet: Boolean(st.googleClientSecret),
        smtpProduct: { email: st.smtpProduct.email, appPasswordSet: Boolean(st.smtpProduct.appPassword) },
        smtpOwner: { email: st.smtpOwner.email, appPasswordSet: Boolean(st.smtpOwner.appPassword) },
        smtpActive: st.smtpActive,
        autoThreshold: st.autoThreshold,
        autoDailyCap: st.autoDailyCap
      }
    });
  }
  if (p === '/api/admin/settings' && req.method === 'PUT') {
    const b = await readJson(req);
    const st = db.settings;
    if (b.siteName) st.siteName = String(b.siteName).slice(0, 40);
    if (b.googleClientId !== undefined) st.googleClientId = String(b.googleClientId).trim();
    if (b.googleClientSecret) st.googleClientSecret = String(b.googleClientSecret).trim();
    for (const slot of ['smtpProduct', 'smtpOwner']) {
      if (b[slot]) {
        if (b[slot].email !== undefined) st[slot].email = normEmail(b[slot].email);
        if (b[slot].appPassword) st[slot].appPassword = String(b[slot].appPassword).trim();
      }
    }
    if (['product', 'owner'].includes(b.smtpActive)) st.smtpActive = b.smtpActive;
    if (b.autoThreshold !== undefined) st.autoThreshold = Math.max(0, Math.min(100, Number(b.autoThreshold) || 60));
    if (b.autoDailyCap !== undefined) st.autoDailyCap = Math.max(1, Math.min(100, Number(b.autoDailyCap) || 10));
    saveDb();
    return sendJson(res, 200, { ok: true, smtpConfigured: smtpConfigured() });
  }
  return sendJson(res, 404, { error: 'Not found.' });
}
function sanitizeJob(b, base) {
  const title = String(b.title || '').trim(), company = String(b.company || '').trim();
  if (!title || !company) return { error: 'Title and company are required.' };
  const applyType = b.applyType === 'email' ? 'email' : 'portal';
  const skills = Array.isArray(b.skills) ? b.skills
    : String(b.skills || '').split(',').map(s => s.trim()).filter(Boolean);
  const job = Object.assign({}, base, {
    title, company,
    city: String(b.city || '').trim() || 'Karachi',
    workType: ['On-site', 'Hybrid', 'Remote'].includes(b.workType) ? b.workType : 'On-site',
    field: String(b.field || '').trim(),
    skills: skills.slice(0, 20),
    applyType,
    applyEmail: applyType === 'email' ? normEmail(b.applyEmail) : '',
    applyLink: String(b.applyLink || '').trim(),
    link: String(b.link || b.applyLink || '').trim(),
    postingDate: String(b.postingDate || '').trim(),
    description: String(b.description || '').trim(),
    active: b.active !== false
  });
  if (applyType === 'email' && !validEmail(job.applyEmail)) return { error: 'A valid apply email is required for email-apply jobs.' };
  return job;
}

// ------------------------------------------------------------------ static
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res, url) {
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  if (file === '/admin') file = '/admin.html';
  const full = path.join(PUBLIC_DIR, path.normalize(file).replace(/^(\.\.[\/\\])+/, ''));
  if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
}

// ------------------------------------------------------------------ server
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    console.error('Request error:', e);
    if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong on the server.' });
  }
});
server.listen(PORT, () => {
  console.log(db.settings.siteName + ' server running at http://localhost:' + PORT);
  console.log('Public site: /   Admin (hidden): /admin');
  if (DEMO_GOOGLE) console.log('*** DEMO_GOOGLE=1 — TEST MODE: Google sends go to data/outbox.log, NOT real email. ***');
  if (!smtpConfigured()) console.log('*** No SMTP configured — verification codes are printed to this console (demo mode). Configure senders in Admin > Settings. ***');
});
