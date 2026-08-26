/* ------------------------------------------------------------------
   QC Cost & Output — the only file you edit.

   Leave MODE as 'demo' to browse sample data with no sign-in.
   Switch to 'live' once the Apps Script relay is deployed.

   Nothing here is secret. The allowlist below is a first gate that keeps
   the wrong person out of the UI; the real check runs again inside
   Relay.gs before BigQuery is touched, so publishing this file does not
   expose salary data.
   ------------------------------------------------------------------ */

window.QC_CONFIG = {

  MODE: 'demo',

  // Apps Script web app URL. Ends in /exec — not /dev.
  RELAY_URL: '',

  // OAuth 2.0 Web client ID from project inspired-frame-453018-r2.
  // Authorised JavaScript origin must include:
  //   https://praveenagarwal24.github.io
  GOOGLE_CLIENT_ID: '',

  // Who can open the dashboard. Keep this identical to ALLOWED_EMAILS
  // in Relay.gs — if the two drift, people get let into the UI and then
  // refused by the relay, which reads as a bug.
  AUTH_ALLOWED_EMAILS: [
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
  ]

};
