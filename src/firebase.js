import { initializeApp } from "firebase/app";
import {
  getFirestore, doc, getDoc, setDoc, runTransaction,
  collection, addDoc, deleteDoc, getDocs, query,
} from "firebase/firestore";
import {
  getAuth, signInAnonymously, signInWithEmailAndPassword, signOut as fbSignOut,
} from "firebase/auth";

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
const auth = getAuth(app);

// ===================== BẢO MẬT — Mức 1 (lớp cũ) + Mức 2 (lớp mới) =====================
// QUYẾT ĐỊNH ĐÃ CHỐT: Mức 2 chỉ áp dụng cho các LỚP MỚI tạo từ nay về sau. 2 lớp đã học xong
// (800+ bài, gồm CBT12S 2605) GIỮ NGUYÊN cấu trúc cũ, không đụng vào. Vì vậy App.jsx cần phân biệt
// từng lớp đang ở "schemaVersion" nào (lưu trong settings_{classCode}.schemaVersion — 1 = cũ,
// 2 = mới; không có trường này = coi như 1) để gọi đúng hàm bên dưới.
//
// - Lớp CŨ (schemaVersion 1): học viên đăng nhập ẩn danh (anonymous) — vẫn như Mức 1 hiện tại,
//   KHÔNG đổi gì cả vì dữ liệu/luồng này đã ổn định, không có lý do để động vào.
// - Lớp MỚI (schemaVersion 2): học viên có tài khoản Firebase Auth THẬT, email giả
//   `${rosterId}@cbm-app.internal`, mật khẩu = mật khẩu đăng nhập app. Nhờ vậy mỗi bài ứng dụng
//   mang theo authUid thật, Rules kiểm soát được "ai chỉ sửa/xóa đúng bài của mình".
const STUDENT_EMAIL_DOMAIN = "cbm-app.internal";
export const studentEmailOf = (rosterId) => `${rosterId}@${STUDENT_EMAIL_DOMAIN}`;

export const authApi = {
  // Lớp cũ: đăng nhập ẩn danh — gọi 1 lần khi app mở lên (xem App.jsx), âm thầm, không ảnh hưởng
  // trải nghiệm học viên.
  async ensureAnonymous() {
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }
    return auth.currentUser;
  },
  // Lớp mới (Mức 2): đăng nhập THẬT — nếu sai mật khẩu, Firebase tự báo lỗi (throw), App.jsx bắt
  // lỗi này để hiện "User AD hoặc mật khẩu không đúng." Lệnh này tự động thay thế phiên ẩn danh
  // đang có (Firebase Auth chỉ giữ 1 phiên đăng nhập tại 1 thời điểm trên 1 app instance).
  async signInStudent(rosterId, password) {
    const cred = await signInWithEmailAndPassword(auth, studentEmailOf(rosterId), password);
    return cred.user;
  },
  async signInAdmin(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user;
  },
  async signOutAll() {
    try { await fbSignOut(auth); } catch (e) { /* noop */ }
  },
  isAdminSignedIn() {
    // Phân biệt BTC bằng email: BTC dùng email thật, học viên lớp mới dùng email giả
    // @cbm-app.internal, học viên lớp cũ là ẩn danh (không có email) — cả 2 trường hợp học viên
    // đều KHÔNG được coi là admin.
    const u = auth.currentUser;
    return !!u && !!u.email && !u.email.endsWith(`@${STUDENT_EMAIL_DOMAIN}`);
  },
  currentUid() {
    return auth.currentUser ? auth.currentUser.uid : null;
  },
  async getIdToken() {
    return auth.currentUser ? auth.currentUser.getIdToken() : null;
  },
};

// API giống hệt window.storage trong Claude artifact — dùng cho roster/settings/classIndex
// (mọi lớp, cũ và mới) + entries của LỚP CŨ (vẫn dạng "1 tài liệu = 1 khối JSON").
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

// ===================== Bài ứng dụng — chỉ LỚP MỚI (Mức 2) dùng =====================
// Mỗi bài là 1 document riêng trong subcollection `classes/{classCode}/entries`, có `authUid` để
// Rules kiểm tra đúng chủ. Lớp cũ KHÔNG dùng API này — vẫn dùng storage.get/update với key
// `entries_{classCode}` như trước (xem App.jsx).
export const entriesApi = {
  async list(classCode) {
    const snap = await getDocs(query(collection(db, "classes", classCode, "entries")));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },
  async add(classCode, entry) {
    // Bỏ field "id" của client (nếu có, dùng cho lớp cũ) trước khi ghi — Firestore tự sinh ID
    // riêng cho document, đó mới là id thật dùng để xóa/sửa sau này.
    const { id: _clientId, ...data } = entry;
    const ref = await addDoc(collection(db, "classes", classCode, "entries"), data);
    return { ...data, id: ref.id };
  },
  async remove(classCode, entryId) {
    await deleteDoc(doc(db, "classes", classCode, "entries", entryId));
  },
};

// ===================== Quản trị tài khoản học viên — chỉ LỚP MỚI (Mức 2) =====================
// Tạo/đổi mật khẩu/xóa tài khoản Firebase Auth THẬT của học viên KHÔNG thể làm trực tiếp từ trình
// duyệt (Firebase chặn việc 1 phiên đang đăng nhập can thiệp tài khoản Auth của NGƯỜI KHÁC — quy
// tắc bảo mật gốc, không phải hạn chế của app). Vì vậy việc này được chuyển qua 1 Vercel Serverless
// Function chạy Firebase Admin SDK (xem api/admin-account.js) — vẫn dùng gói Firebase Spark + Vercel
// Hobby miễn phí, KHÔNG cần nâng cấp Blaze/Cloud Functions.
async function callAdminApi(action, payload) {
  const idToken = await authApi.getIdToken();
  if (!idToken) throw new Error("Chưa đăng nhập BTC.");
  const res = await fetch("/api/admin-account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, idToken, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Lỗi gọi API quản trị tài khoản.");
  return data;
}

export const studentAccountApi = {
  createStudentAuth(rosterId, password) {
    return callAdminApi("create-student", { rosterId, password });
  },
  resetStudentPassword(rosterId, newPassword) {
    return callAdminApi("reset-password", { rosterId, newPassword });
  },
  deleteStudentAuth(rosterId) {
    return callAdminApi("delete-student", { rosterId });
  },
};
