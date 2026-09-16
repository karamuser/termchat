import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import {
    getFirestore, collection, doc, addDoc, setDoc, getDoc, getDocs, deleteDoc,
    query, orderBy, limit, onSnapshot, serverTimestamp, where
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import {
    getAuth, GoogleAuthProvider, signInWithPopup,
    signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyAwc92povSAyJOICmp6HS5MTaTgjqkxIzE",
    authDomain: "termchat-81402.firebaseapp.com",
    projectId: "termchat-81402",
    storageBucket: "termchat-81402.firebasestorage.app",
    messagingSenderId: "446224290902",
    appId: "1:446224290902:web:829989859dd18766a657f7",
    measurementId: "G-ZGM6K55MCV"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export {
    db, auth, googleProvider,
    collection, doc, addDoc, setDoc, getDoc, getDocs, deleteDoc,
    query, orderBy, limit, onSnapshot, serverTimestamp, where,
    signInWithPopup, signOut, onAuthStateChanged
};