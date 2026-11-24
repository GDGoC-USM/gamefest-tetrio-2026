
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

// ==========================================
// FIREBASE INITIALIZATION
// ==========================================

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export const googleProvider = new GoogleAuthProvider();

// ==========================================
// FIREBASE EXPORTS
// ==========================================

export {
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,

  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp
};

// ==========================================
// GOOGLE SIGN-IN
// ==========================================

export async function signIn() {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

// ==========================================
// ADMIN SIGN-IN
// ==========================================

export async function adminSignIn(email, password) {
  const result = await signInWithEmailAndPassword(
    auth,
    email,
    password
  );

  return result.user;
}

// ==========================================
// ADMIN VERIFICATION
// ==========================================

export async function isAdmin(user) {
  if (!user) return false;

  const adminRef = doc(db, "admins", user.uid);
  const snapshot = await getDoc(adminRef);

  return (
    snapshot.exists() &&
    snapshot.data().role === "admin"
  );
}

// ==========================================
// MESSAGE DISPLAY
// ==========================================

export function showMessage(element, message, type = "info") {
  if (!element) return;

  element.textContent = message;
  element.className = `notice ${type}`;
}

// ==========================================
// HTML SECURITY
// ==========================================

export function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

// ==========================================
// DATE FORMATTING
// ==========================================

export function formatDate(value) {
  if (!value) return "TBC";

  const date = value.toDate
    ? value.toDate()
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "TBC";
  }

  return date.toLocaleString();
}
