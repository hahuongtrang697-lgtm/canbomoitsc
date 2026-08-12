import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

// 🔧 Firebase config của BẢN 2 (project: canbomoitscv2) — tách biệt hoàn toàn với bản 1
const firebaseConfig = {
  apiKey: "AIzaSyCQaeC_N93sZOQGSXWmZmm6hXm92U9kETY",
  authDomain: "canbomoitscv2.firebaseapp.com",
  projectId: "canbomoitscv2",
  storageBucket: "canbomoitscv2.firebasestorage.app",
  messagingSenderId: "671828904089",
  appId: "1:671828904089:web:6155b11d9039f7f00e9008",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// API giống hệt window.storage trong Claude artifact, để phần còn lại
// của app (App.jsx) không cần sửa gì thêm.
export const storage = {
  async get(key) {
    const snap = await getDoc(doc(db, "appdata", key));
    if (!snap.exists()) return null;
    return { key, value: snap.data().value };
  },
  async set(key, value) {
    await setDoc(doc(db, "appdata", key), { value });
    return { key, value };
  },
};
