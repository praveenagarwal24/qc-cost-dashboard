/**
 * QC Cost & Output — Apps Script relay
 *
 * GitHub Pages is static and cannot hold a BigQuery credential, so the page
 * sends the signed-in user's Google ID token here. This script verifies the
 * token against Google, checks the allowlist, runs the query under its own
 * service identity, and returns JSON.
 *
 * The allowlist check MUST live here. A check in the browser only hides the
 * UI — anyone who finds the /exec URL could still pull salary figures.
 *
 * SETUP
 *  1. Services (+) -> BigQuery API -> Add.
 *  2. Fill in CFG below.
 *  3. Deploy -> New deployment -> Web app
 *       Execute as:     Me
 *       Who has access: Anyone
 *     Copy the /exec URL into the dashboard's RELAY_URL.
 *  4. Run the view DDL in bq_qc_cost.sql once before first use.
 */

var CFG = {
  PROJECT_ID: 'inspired-frame-453018-r2',
  DATASET:    'spyne_reviews',

  // OAuth 2.0 Web client ID from the same GCP project.
  // Authorised JavaScript origin: https://praveenagarwal24.github.io
  CLIENT_ID: 'REPLACE_ME.apps.googleusercontent.com',

  // Who may load the dashboard at all.
  // Keep identical to AUTH_ALLOWED_EMAILS in config.js.
  ALLOWED_EMAILS: [
    'praveen@spyne.ai',
    'praveenagarwal24@gmail.com',
    'kishor@spyne.ai',
    'raj.tripathi@spyne.ai',
    'ranbir.manoranjan@spyne.ai',
    'ajay.devrani@spyne.co.in',
    'khushi.gautam@spyne.co.in',
    'shweta.gupta@spyne.co.in',
    'tannu.singh@spyne.co.in',
    'vijay.gautam@spyne.co.in',
    'karmendra.singh@spyne.co.in',
    'anup.gupta@spyne.co.in',
    'dhruv.kumar@spyne.co.in'
  ],

  // Optional: allow a whole domain. Leave empty to use ALLOWED_EMAILS only.
  ALLOWED_DOMAINS: [],

  // Subset of ALLOWED_EMAILS who may see rupee figures. Everyone else gets
  // volume and productivity with salary and cost blanked out before the
  // response leaves the server. Empty array = everyone sees cost.
  COST_VIEWERS: [
    'praveen@spyne.ai',
    'praveenagarwal24@gmail.com',
    'kishor@spyne.ai'
  ],

  CACHE_MINUTES: 30
};


/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

function doPost(e) {
  return handle_(safeParse_(e && e.postData && e.postData.contents));
}

function doGet(e) {
  // Handy for a browser smoke test: ?ping=1
  if (e && e.parameter && e.parameter.ping) {
    return json_({ ok: true, service: 'qc-cost-relay' });
  }
  return handle_(e ? e.parameter : {});
}

function handle_(req) {
  try {
    req = req || {};
    var user = verifyToken_(req.token);

    if (!isAllowed_(user.email)) {
      return json_({ ok: false, error: 'not_authorised',
                     message: user.email + ' is not on the dashboard access list.' });
    }

    var canSeeCost = CFG.COST_VIEWERS.length === 0 ||
                     CFG.COST_VIEWERS.indexOf(user.email) !== -1;

    var wanted = String(req.datasets || 'fact,heat,gaps').split(',');
    var out = {};
    wanted.forEach(function (name) {
      name = name.trim();
      if (QUERIES[name]) out[name] = runCached_(name, req.refresh === '1' || req.refresh === true);
    });

    if (!canSeeCost) out = stripCost_(out);

    return json_({
      ok: true,
      user: { email: user.email, name: user.name, picture: user.picture },
      canSeeCost: canSeeCost,
      generatedAt: new Date().toISOString(),
      data: out
    });

  } catch (err) {
    return json_({ ok: false, error: 'failed', message: String(err && err.message || err) });
  }
}


/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

function verifyToken_(idToken) {
  if (!idToken) throw new Error('Sign in to load this dashboard.');

  var res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) throw new Error('Your session expired. Sign in again.');

  var info = JSON.parse(res.getContentText());

  if (info.aud !== CFG.CLIENT_ID)         throw new Error('Token was issued for a different app.');
  if (String(info.email_verified) !== 'true') throw new Error('This Google account is not verified.');
  if (Number(info.exp) * 1000 < Date.now()) throw new Error('Your session expired. Sign in again.');

  return { email: String(info.email).toLowerCase(), name: info.name, picture: info.picture };
}

function isAllowed_(email) {
  if (CFG.ALLOWED_EMAILS.map(lower_).indexOf(email) !== -1) return true;
  var domain = email.split('@')[1] || '';
  return CFG.ALLOWED_DOMAINS.map(lower_).indexOf(domain) !== -1;
}

function lower_(s) { return String(s).toLowerCase(); }


/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

var V = '`' + 'inspired-frame-453018-r2.spyne_reviews.v_qc_cost' + '`';

var QUERIES = {

  fact:
    'SELECT month_key, month_start, enterprise_id, enterprise, team_id, team_name, ' +
    '       dealer_type, product, work_type, verticle, qc_email, emp_no, emp_name, is_matched, ' +
    '       MAX(qc_month_salary) AS qc_month_salary, MAX(qc_month_images) AS qc_month_images, ' +
    '       COUNT(DISTINCT work_date) AS active_days, ' +
    '       SUM(images) AS images, SUM(sku_count) AS skus, SUM(tool_count) AS tool_count, ' +
    '       SUM(target) AS target, SUM(alloc_cost) AS cost ' +
    'FROM ' + V + ' GROUP BY 1,2,3,4,5,6,7,8,9,10,11,12,13,14',

  heat:
    'SELECT month_key, work_dow, work_hour, SUM(images) AS images, ' +
    '       SUM(alloc_cost) AS cost, COUNT(DISTINCT qc_email) AS qcs ' +
    'FROM ' + V + ' GROUP BY 1,2,3',

  gaps:
    'SELECT "output_without_salary" AS gap_type, month_key, qc_email, ' +
    '       CAST(NULL AS STRING) AS emp_no, CAST(NULL AS STRING) AS emp_name, ' +
    '       SUM(images) AS images, 0.0 AS salary ' +
    'FROM ' + V + ' WHERE NOT is_matched GROUP BY 1,2,3 ' +
    'UNION ALL ' +
    'SELECT "salary_without_output", s.month_key, s.qc_email, s.emp_no, s.emp_name, 0, ' +
    '       SUM(IFNULL(SAFE_CAST(s.salary AS FLOAT64),0)) ' +
    'FROM (SELECT REPLACE(TRIM(CAST(Month AS STRING)), "\u2019", "\'") AS month_key, ' +
    '             CAST(`Employee Number` AS STRING) AS emp_no, ' +
    '             TRIM(CAST(`Employee Name` AS STRING)) AS emp_name, ' +
    '             LOWER(TRIM(CAST(`Work Email` AS STRING))) AS qc_email, Salary AS salary ' +
    '      FROM `inspired-frame-453018-r2.spyne_reviews.salary_sheet`) s ' +
    'LEFT JOIN (SELECT DISTINCT qc_email, month_key FROM ' + V + ') d ' +
    '  ON d.qc_email = s.qc_email AND d.month_key = s.month_key ' +
    'WHERE d.qc_email IS NULL GROUP BY 1,2,3,4,5'
};


function runCached_(name, forceRefresh) {
  var cache = CacheService.getScriptCache();
  var key = 'qccost_v1_' + name;

  if (!forceRefresh) {
    var hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  }

  var rows = runQuery_(QUERIES[name]);
  var payload = JSON.stringify(rows);

  // CacheService caps a single value at 100KB; skip caching if we exceed it.
  if (payload.length < 95000) cache.put(key, payload, CFG.CACHE_MINUTES * 60);

  return rows;
}

function runQuery_(sql) {
  var job = BigQuery.Jobs.query(
    { query: sql, useLegacySql: false, timeoutMs: 120000, maxResults: 50000 },
    CFG.PROJECT_ID
  );

  var jobId = job.jobReference.jobId;
  var loc = job.jobReference.location;
  var waited = 0;
  while (!job.jobComplete && waited < 120000) {
    Utilities.sleep(1500);
    waited += 1500;
    job = BigQuery.Jobs.getQueryResults(CFG.PROJECT_ID, jobId, { location: loc });
  }
  if (!job.jobComplete) throw new Error('BigQuery timed out. Narrow the date range and retry.');

  var fields = job.schema.fields.map(function (f) { return { name: f.name, type: f.type }; });
  var rows = [];

  function collect(page) {
    (page.rows || []).forEach(function (r) {
      var o = {};
      r.f.forEach(function (cell, i) { o[fields[i].name] = coerce_(cell.v, fields[i].type); });
      rows.push(o);
    });
    return page.pageToken;
  }

  var token = collect(job);
  while (token) {
    var page = BigQuery.Jobs.getQueryResults(
      CFG.PROJECT_ID, jobId, { pageToken: token, location: loc, maxResults: 50000 });
    token = collect(page);
  }
  return rows;
}

function coerce_(v, type) {
  if (v === null || v === undefined) return null;
  if (type === 'INTEGER' || type === 'FLOAT' || type === 'NUMERIC') return Number(v);
  if (type === 'BOOLEAN') return v === 'true' || v === true;
  return v;
}

function stripCost_(data) {
  ['cost', 'qc_month_salary', 'salary'].forEach(function (f) {
    Object.keys(data).forEach(function (k) {
      data[k].forEach(function (row) { if (f in row) row[f] = null; });
    });
  });
  return data;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
