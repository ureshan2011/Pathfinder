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

window.PF_FIREBASE_CONFIG = null;

/* Example:
window.PF_FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "pathfinder-xxxxx.firebaseapp.com",
  projectId: "pathfinder-xxxxx",
  storageBucket: "pathfinder-xxxxx.appspot.com",
  messagingSenderId: "...",
  appId: "1:...:web:..."
};
*/

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
