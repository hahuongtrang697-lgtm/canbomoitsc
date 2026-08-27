import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, runTransaction } from "firebase/firestore";

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
  // update: đọc + sửa + ghi trong 1 GIAO DỊCH AN TOÀN (Firestore Transaction) thật sự.
  // Nếu 2 người cùng ghi vào đúng 1 tài liệu ở cùng 1 thời điểm, Firebase tự phát hiện xung đột,
  // âm thầm chạy lại giao dịch của người đến sau bằng đúng dữ liệu mới nhất — đảm bảo không ai
  // bị mất dữ liệu do bị ghi đè, dù bao nhiêu người thao tác cùng lúc.
  async update(key, mutatorFn) {
    const ref = doc(db, "appdata", key);
    const result = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists() ? JSON.parse(snap.data().value) : null;
      const next = mutatorFn(current);
      tx.set(ref, { value: JSON.stringify(next) });
      return next;
    });
    return result;
  },
};
