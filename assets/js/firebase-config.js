/* ════════════════════════════════════════════════════════════
   PathFinder — Firebase configuration
   Paste your project's web-app config here (Firebase console →
   Project settings → Your apps → Web app → Config).

   Leave as null and the site runs 100% locally (localStorage)
   with no Firebase calls at all — nothing else changes.

   Free (Spark) plan services used:
     · Authentication (Google sign-in + anonymous)
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
