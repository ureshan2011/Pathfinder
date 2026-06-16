/* ════════════════════════════════════════════════════════════
   PathFinder — Firebase configuration
   Paste your project's web-app config here (Firebase console →
   Project settings → Your apps → Web app → Config).

   Leave as null and the site runs 100% locally (localStorage)
   with no Firebase calls at all — nothing else changes.

   Free (Spark) plan services used:
     · Authentication (Google + Anonymous + one Email/Password admin)
     · Cloud Firestore  (user data sync + leads/consultation inbox)
     · Hosting          (deploy with `firebase deploy`)
   ════════════════════════════════════════════════════════════ */

window.PF_FIREBASE_CONFIG = {
  apiKey: "AIzaSyB3N85Ezou0KmklXfeU2Gs3gMSdIFQ92p8",
  authDomain: "pathfinder-b3fde.firebaseapp.com",
  projectId: "pathfinder-b3fde",
  storageBucket: "pathfinder-b3fde.firebasestorage.app",
  messagingSenderId: "883950276586",
  appId: "1:883950276586:web:0409366ea0d2ad6880ec93"
};

/* ── Admin account ───────────────────────────────────────────
   The in-app admin panel (app.html#admin) is opened with a single
   password box. That box signs into THIS Firebase Auth account
   (Email/Password provider). Firestore rules grant read access to
   the leads / consultations / user records ONLY to this email —
   so the data is never exposed to ordinary visitors.

   Setup (once):
     1. Firebase console → Authentication → Sign-in method →
        enable "Email/Password".
     2. Authentication → Users → Add user:
          email:    the address below
          password: adminadmin   (change it after first login)
     3. Make sure PF_ADMIN_EMAIL below matches that address AND the
        email hard-coded in firestore.rules (isAdmin()).

   Nothing secret lives in this file — the password is typed at the
   gate at runtime, never stored here.
   ──────────────────────────────────────────────────────────── */
window.PF_ADMIN_EMAIL = 'admin@pathfinder.app';

/* ── Role secret codes ───────────────────────────────────────
   PathFinder has three login roles:

     · Client / Student — login is OPTIONAL. Anyone can use the app
       anonymously; creating an account (to sync across devices)
       needs NO code.
     · Mentor — invite-only. Creating a mentor account requires the
       `mentor` code below, AND the new account starts as PENDING:
       an admin must approve it in the Admin panel before the mentor
       can claim requests. Two gates: the code, then approval.
     · Admin — the Admin panel asks for the `admin` code before the
       Firebase admin password.

   IMPORTANT — these codes are a soft gate only (they ship in client
   JS, so a determined visitor can read them). They exist to keep
   casual users out of the mentor/admin flows. The REAL security is
   enforced server-side by firestore.rules: a mentor can do nothing
   privileged until an admin sets approved:true, and admin reads are
   granted only to the admin email's authenticated session. Rotate
   these codes by editing this file and redeploying.
   ──────────────────────────────────────────────────────────── */
window.PF_ROLE_CODES = {
  mentor: 'MNTR',
  admin:  'ADMN',
};
