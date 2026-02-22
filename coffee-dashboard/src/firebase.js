// src/firebase.js
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
    apiKey: "AIzaSyDYE0fHD3sodrJNrEUpVAhFehlOXnVBrQQ",
    authDomain: "coffee-dashboard-2a8ce.firebaseapp.com",
    databaseURL: "https://coffee-dashboard-2a8ce-default-rtdb.firebaseio.com",
    projectId: "coffee-dashboard-2a8ce",
    storageBucket: "coffee-dashboard-2a8ce.firebasestorage.app",
    messagingSenderId: "695508655030",
    appId: "1:695508655030:web:e685a3d9f72395159f3f17",
    measurementId: "G-8XR9CQCY8P"
};

const app = initializeApp(firebaseConfig);
export const database = getDatabase(app);