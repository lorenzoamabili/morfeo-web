// ═══════════════════════════════════════════════════════════════
// MORFEO — firebase-config.js
// Fill in your Firebase project configuration here.
//
// Setup steps:
//   1. Go to https://console.firebase.google.com
//   2. Create a project (or open an existing one)
//   3. Authentication → Sign-in method → enable Email/Password
//   4. Firestore Database → Create database (production mode)
//   5. Project Settings → Your apps → Add web app → copy config below
//   6. Firestore → Rules → replace with:
//
//        rules_version = '2';
//        service cloud.firestore {
//          match /databases/{database}/documents {
//            match /users/{userId} {
//              allow read, write: if request.auth != null
//                                 && request.auth.uid == userId;
//            }
//          }
//        }
// ═══════════════════════════════════════════════════════════════

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBaQF1pQ8q1yK28UFk7Q5VgaGCDezgdco0",
  authDomain: "morfeo-webapp.firebaseapp.com",
  projectId: "morfeo-webapp",
  storageBucket: "morfeo-webapp.firebasestorage.app",
  messagingSenderId: "291801972074",
  appId: "1:291801972074:web:ca0ffa02321056d71f7913",
  measurementId: "G-SY41330HXC",
};