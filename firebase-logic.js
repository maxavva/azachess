import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, setDoc, getDoc, collection, addDoc, query, where, getDocs, orderBy, limit, startAfter, onSnapshot, runTransaction, deleteDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// КОНФИГ FIREBASE
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

// Стабильный современный офлайн кэш без deprecation-предупреждений (SDK v10+)
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

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
