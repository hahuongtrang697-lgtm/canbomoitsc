import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

// 🔧 Firebase config của bạn (project: canbomoitsc)
const firebaseConfig = {
  apiKey: "AIzaSyBwBMHQk-8IMSef-D3z5vZoraBPetQvON0",
  authDomain: "canbomoitsc.firebaseapp.com",
  projectId: "canbomoitsc",
  storageBucket: "canbomoitsc.firebasestorage.app",
  messagingSenderId: "710763786127",
  appId: "1:710763786127:web:3e145a53ae2c0c974625fa",
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
