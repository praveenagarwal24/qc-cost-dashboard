# Setup, step by step

Six stages. Stage 1 gets you a live URL on sample data in about five
minutes — do that first and review the layout before wiring up data.

Stages 3 and 4 have two steps that are easy to miss and produce
confusing errors later. They are flagged **Do not skip**.

---

# Stage 1 — Publish on GitHub Pages

### 1.1 Create the repository

github.com → **+** (top right) → **New repository**

- Owner: `praveenagarwal24`
- Repository name: `qc-cost-dashboard`
- **Public** (GitHub Pages needs this on the free plan)
- Do **not** tick "Add a README file" — the repo already has one
- **Create repository**

### 1.2 Push the files

Command line:

```bash
cd qc-cost-dashboard
git init
git add .
git commit -m "QC cost dashboard"
git branch -M main
git remote add origin https://github.com/praveenagarwal24/qc-cost-dashboard.git
git push -u origin main
```

Or in the browser: on the empty repo page click **uploading an existing
file**, drag in all six files, **Commit changes**.

If you upload via the browser, check `.nojekyll` actually landed. It
starts with a dot so some file pickers hide it. Without it, Pages may
skip files. If it is missing: **Add file → Create new file**, name it
`.nojekyll`, leave it empty, commit.

### 1.3 Turn on Pages

Repo → **Settings** → **Pages** (left sidebar)

- Source: **Deploy from a branch**
- Branch: `main`, folder: `/ (root)`
- **Save**

First build takes 1–3 minutes. When the banner turns green, open:

```
https://praveenagarwal24.github.io/qc-cost-dashboard/
```

You should see the dashboard on sample data with an amber "Sample data"
strip at the top. Click through the filters and the drill-down.

**Stop here and send me the URL if you want layout changes before the
data is wired up.**

---

# Stage 2 — Create the BigQuery view

### 2.1 Run the DDL

console.cloud.google.com/bigquery, project
`inspired-frame-453018-r2` selected in the top bar.

**+ (Compose new query)** → open `bq_qc_cost.sql` → copy everything from
`CREATE OR REPLACE VIEW` down to the `;` before section 2 → paste → **Run**.

Expect: *This statement created a new view named v_qc_cost.*

### 2.2 Confirm the join actually matched

New query, paste and run:

```sql
SELECT
  COUNTIF(is_matched)       AS matched_rows,
  COUNTIF(NOT is_matched)   AS unmatched_rows,
  COUNT(DISTINCT qc_email)  AS qcs,
  COUNT(DISTINCT month_key) AS months
FROM `inspired-frame-453018-r2.spyne_reviews.v_qc_cost`;
```

**`matched_rows` must be greater than 0.** If it is 0, the two month
keys are not lining up. Run both of these and send me the output:

```sql
SELECT DISTINCT month_key
FROM `inspired-frame-453018-r2.spyne_reviews.v_qc_cost` ORDER BY 1;

SELECT DISTINCT TRIM(CAST(Month AS STRING)) AS salary_month
FROM `inspired-frame-453018-r2.spyne_reviews.salary_sheet` ORDER BY 1;
```

Both need to read `Apr'26`, `May'26`, `Jun'26`, `Jul'26`. If the first
query returns nothing at all, `Hourly_Date` is a string the parser did
not recognise — send me a sample value and I will fix the parse.

### 2.3 Note the project number

**Do not skip.** You need this in stage 4.

Click the project selector in the blue bar → find
`inspired-frame-453018-r2` in the list. The **project number** is the
long digit string next to it, something like `284719305562`. It is not
the same as the project ID. Copy it somewhere.

---

# Stage 3 — OAuth client

You have two routes. The first is much faster.

## Route A — reuse the review tool's client

Your `insta.html` already uses a working client:
`108193022090-pqojr6seugmdmth5jrah9rgisjgn2q28.apps.googleusercontent.com`.
Its consent screen is already configured and its users already trust it.
All it needs is the new origin.

Google Cloud console → switch to whichever project owns that client →
**APIs & Services → Credentials** → click the client name → under
**Authorised JavaScript origins** click **+ ADD URI**:

```
https://praveenagarwal24.github.io
```

**Save.** Copy the client ID. Done — skip to stage 4.

> Origins are the domain only. No path, no trailing slash. One entry
> covers every repo under `praveenagarwal24.github.io`.

## Route B — new client in inspired-frame-453018-r2

Cleaner separation, but you must set up the consent screen first.

### 3.1 Consent screen

**APIs & Services → OAuth consent screen**

- User type: **Internal** if the option is available — pick it and you
  are done, anyone with a Spyne Google account can sign in.
- If Internal is greyed out, the project sits under a personal account
  rather than the Workspace org. Choose **External**, then:
  - App name: `QC Cost Dashboard`
  - User support email: your address
  - Developer contact: your address
  - **Save and continue** through Scopes (add none) and Test users
  - On **Test users**, click **+ ADD USERS** and paste all 13 addresses
    from `config.js`. **Anyone not on this list cannot sign in**,
    regardless of the dashboard allowlist.

> External + Testing is capped at 100 test users and shows an
> "unverified app" warning on first sign-in. Users click
> **Advanced → Go to QC Cost Dashboard (unsafe)** once. For 13 internal
> people this is fine. Route A avoids it entirely.

### 3.2 Create the client

**APIs & Services → Credentials → + CREATE CREDENTIALS → OAuth client ID**

- Application type: **Web application**
- Name: `QC Cost Dashboard`
- **Authorised JavaScript origins → + ADD URI**:
  `https://praveenagarwal24.github.io`
- **Authorised redirect URIs**: leave empty
- **Create**

Copy the client ID from the dialog.

---

# Stage 4 — Deploy the relay

### 4.1 Create the project

script.google.com → **New project** → rename it `QC Cost Relay`
(click "Untitled project" at the top).

Delete the stub `myFunction` code, paste in all of `Relay.gs`, save
(⌘S / Ctrl+S).

### 4.2 Point it at the right GCP project

**Do not skip.** BigQuery needs a billing-enabled project. Apps Script's
default hidden project has no billing, so the query fails with a
permissions error that does not mention billing at all.

Left sidebar → **⚙ Project Settings** → **Google Cloud Platform (GCP)
Project** → **Change project** → paste the **project number** from step
2.3 → **Set project**.

If it refuses, the consent screen for that project is not configured —
go back to stage 3.1.

### 4.3 Add the BigQuery service

Left sidebar → **Services** → **+** → scroll to **BigQuery API** →
**Add**. It should appear as `BigQuery` in the sidebar.

### 4.4 Fill in CFG

At the top of `Relay.gs`:

```js
CLIENT_ID: 'paste-the-client-id-here.apps.googleusercontent.com',
```

`ALLOWED_EMAILS` already holds your 13 addresses. Trim it to who should
see payroll data.

`COST_VIEWERS` is the smaller group who see rupee figures. Everyone else
gets images, SKUs and productivity with salary and cost blanked out
before the response leaves the server. Currently set to you, Kishor and
your Gmail.

Save.

### 4.5 Authorise it once

The script needs your permission to call BigQuery and to fetch from
Google. Trigger that now rather than discovering it mid-deploy.

Function dropdown at the top → select **doGet** → **Run**.

- "Authorization required" → **Review permissions**
- Pick your Google account
- "Google hasn't verified this app" → **Advanced** →
  **Go to QC Cost Relay (unsafe)**
- **Allow**

The execution log will show an error about `e` being undefined. That is
expected — `doGet` was called with no request. The authorisation is what
mattered.

### 4.6 Deploy

**Deploy → New deployment**

- Click the **⚙** next to "Select type" → **Web app**
- Description: `v1`
- **Execute as: Me (your@email)**
- **Who has access: Anyone**
- **Deploy**

Copy the **Web app URL**. It ends in `/exec`.

> "Anyone" only means Google will route the request through. The script
> rejects any caller whose token is missing, expired, issued to a
> different client ID, or not on `ALLOWED_EMAILS`.
>
> "Anyone with a Google Account" also works but adds a redirect that
> breaks the CORS fetch. Use **Anyone**.

### 4.7 Smoke test

Open in a browser tab:

```
https://script.google.com/macros/s/AKfy.../exec?ping=1
```

Expected: `{"ok":true,"service":"qc-cost-relay"}`

If you get a Google sign-in page or an error page instead, the
deployment is not set to "Anyone", or you copied the `/dev` URL.

---

# Stage 5 — Go live

Edit `config.js` in the repo:

```js
MODE: 'live',
RELAY_URL: 'https://script.google.com/macros/s/AKfy.../exec',
GOOGLE_CLIENT_ID: '1234...apps.googleusercontent.com',
```

Then edit `index.html` and bump the cache-buster — find this line near
the bottom and change `v=1` to `v=2`:

```html
<script src="config.js?v=1"></script>
```

GitHub Pages caches hard. Without the bump you will edit config, push,
reload, and see no change for up to ten minutes.

Commit and push both files. Wait for the Pages build (repo → **Actions**
shows progress).

---

# Stage 6 — Verify

Open the dashboard in a **private window** so you test a cold session.

1. Sign-in screen appears, not sample data
2. Google button renders → click → pick your account
3. "Loading from BigQuery…" appears
4. Dashboard loads, amber banner gone, your name and photo top right
5. Figures are non-zero and the month labels match the salary sheet
6. Click **Sign out** → back to the sign-in screen
7. Sign in again → should go straight through without the account picker

Then ask one person from the allowlist and one person not on it to try.
The second should see *"… is not on the access list."*

---

# Error reference

| What you see | Where | Fix |
|---|---|---|
| Sample data still showing | Dashboard | `MODE` still `'demo'`, or Pages cache — bump `config.js?v=` |
| `Add RELAY_URL to config.js` | Dashboard | Field left blank |
| Sign-in button never renders | Dashboard | Origin missing from the OAuth client (stage 3) |
| `Access blocked: has not completed verification` | Google popup | External consent screen, email not in Test users (stage 3.1) |
| `Token was issued for a different app` | Dashboard | `CLIENT_ID` in Relay.gs ≠ `GOOGLE_CLIENT_ID` in config.js |
| `… is not on the access list` for someone valid | Dashboard | Add to `AUTH_ALLOWED_EMAILS`, push |
| Passes sign-in, relay refuses | Dashboard | The two allowlists have drifted — sync them |
| `The relay did not respond (HTTP 401/403)` | Dashboard | Deployment not "Anyone", or `/dev` URL used |
| `Access Denied: Project` or `User does not have bigquery.jobs.create` | Relay | GCP project not switched (stage 4.2) |
| `BigQuery is not defined` | Relay | Advanced service not added (stage 4.3) |
| Loads but every panel is empty | Dashboard | View returned no rows — rerun the check in step 2.2 |
| `BigQuery timed out` | Relay | Narrow the view to recent months, redeploy |

---

# After changes

**Adding a person:** edit `AUTH_ALLOWED_EMAILS` in `config.js`, push, and
edit `ALLOWED_EMAILS` in the relay. Then **Deploy → Manage deployments →
✏️ edit → Version: New version → Deploy**. Editing the existing
deployment keeps the URL the same. Creating a *new* deployment gives a
new URL and breaks the dashboard.

**Changing a query:** same redeploy flow. The relay caches results for
30 minutes — lower `CACHE_MINUTES` while testing.
