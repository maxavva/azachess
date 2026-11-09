import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager, doc, setDoc, getDoc, collection, addDoc, query, where, getDocs, orderBy, limit, startAfter, onSnapshot, runTransaction, deleteDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ТВОЙ КОНФИГ FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyBocj4buVq00osycrLRSnJDW_6PgapHu0o",
  authDomain: "azachess.firebaseapp.com",
  projectId: "azachess",
  storageBucket: "azachess.firebasestorage.app",
  messagingSenderId: "275982919791",
  appId: "1:275982919791:web:a0f16c7e1dab8830bb059a"
};

// Инициализация
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Стабильный офлайн-кэш на базе IndexedDB (Firebase SDK v10)
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
} catch (error) {
  // Private browsing or restricted IndexedDB should not prevent online play.
  console.warn("Постоянный кэш Firestore недоступен; запускаем без него.", error);
  db = getFirestore(app);
}

export { 
  auth, 
  db, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  onAuthStateChanged, 
  signOut, 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  addDoc, 
  query, 
  where, 
  getDocs, 
  orderBy, 
  limit, 
  startAfter,
  onSnapshot,
  runTransaction,
  deleteDoc,
  updateDoc
};
