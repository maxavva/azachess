import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, where, getDocs, orderBy, limit, startAfter, enableIndexedDbPersistence, onSnapshot, runTransaction, deleteDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
const db = getFirestore(app);

// Стабильное автономное кэширование (IndexedDB)
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === 'failed-precondition') {
    console.warn("Обнаружено несколько открытых вкладок. Автономное кэширование активно только в одной вкладке.");
  } else if (err.code === 'unimplemented') {
    console.warn("Данный браузер не поддерживает автономное кэширование IndexedDB.");
  }
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
