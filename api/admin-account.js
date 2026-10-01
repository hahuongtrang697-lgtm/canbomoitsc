// Vercel Serverless Function — chạy Firebase Admin SDK phía SERVER (không bao giờ lộ ra trình
// duyệt). Đây là "backend nhẹ" cho Mức 2: cho phép BTC tạo/đổi mật khẩu/xóa tài khoản Firebase Auth
// THẬT của học viên NGAY TRONG APP, thay vì phải tự chạy script trên máy.
//
// Dùng gói Vercel Hobby (miễn phí) + Firebase Spark (miễn phí) — Admin SDK không tính phí theo gói,
// các lệnh createUser/updateUser/deleteUser luôn miễn phí trên mọi gói Firebase.
//
// CÀI ĐẶT (làm 1 lần, trên Vercel Dashboard của project canbomoitsc-v2):
//   1. Firebase Console → Project settings → Service accounts → "Generate new private key"
//      → tải file .json về.
//   2. Mã hoá CẢ FILE đó thành 1 chuỗi base64 (tránh lỗi copy/dán thủ công từng trường hay bị sai
//      định dạng \n của private_key) — chạy 1 trong 2 lệnh sau trên máy bạn, kết quả tự copy vào
//      clipboard luôn, không hiện ra màn hình:
//        macOS (Terminal):   base64 -i duong-dan-file.json | pbcopy
//        Windows (PowerShell): [Convert]::ToBase64String([IO.File]::ReadAllBytes("duong-dan-file.json")) | Set-Clipboard
//   3. Vercel → Project → Settings → Environment Variables → thêm 1 biến DUY NHẤT:
//        FIREBASE_SERVICE_ACCOUNT_BASE64 = (dán clipboard — Ctrl+V / Cmd+V)
//      (Giữ lại hay xoá 3 biến FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY cũ
//      đều được — code dưới đây ưu tiên biến base64 này nếu có, bỏ qua 3 biến cũ.)
//   4. npm install firebase-admin (thêm vào package.json của repo chính, KHÔNG phải file riêng)
//   5. git push + Redeploy trên Vercel — route sẽ chạy tại /api/admin-account
//
// Không đưa file service-account .json lên Git — chỉ dùng để tạo chuỗi base64 rồi xóa khỏi máy.

// Dùng import "modular" (khuyến nghị chính thức từ firebase-admin v12+) thay vì kiểu cũ
// `import admin from "firebase-admin"` — cách cũ dựa vào 1 object "admin" gộp chung (admin.apps,
// admin.auth(), admin.firestore()...) và từng gây lỗi "Cannot read properties of undefined
// (reading 'length')" ngay tại admin.apps.length khi chạy trong môi trường ES Module (project này
// có "type": "module") trên Vercel.
//
// QUAN TRỌNG: import bằng `await import(...)` (động) thay vì `import ... from` (tĩnh) ở đầu file —
// nếu Vercel không bundle đúng các sub-path "firebase-admin/app"/"auth"/"firestore", lỗi sẽ xảy ra
// NGAY LÚC NẠP MODULE với kiểu import tĩnh, khiến handler() không bao giờ chạy được, trả về trang lỗi
// trắng không rõ nguyên nhân (kể cả request GET đơn giản cũng lỗi). Import động đặt lỗi này vào ĐÚNG
// bên trong try/catch của ensureInitialized(), để nếu có lỗi gì (kể cả lỗi "Cannot find module") đều
// trả về dạng JSON {"error": "[INIT] ..."} đọc được, không còn trang lỗi trắng nữa.
async function ensureInitialized() {
  const { initializeApp, cert, getApps } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore } = await import("firebase-admin/firestore");

  function loadCredential() {
    const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    if (b64) {
      // Cách ưu tiên — không có ký tự \n nào cần xử lý tay, không thể dán sai định dạng.
      const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
      return cert(json);
    }
    // Cách cũ (3 biến riêng) — giữ lại để không phá vỡ cấu hình nếu ai đó đã làm theo cách này.
    return cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    });
  }

  if (!getApps().length) {
    initializeApp({ credential: loadCredential() });
  }
  return { auth: getAuth(), db: getFirestore() };
}

const STUDENT_EMAIL_DOMAIN = "cbm-app.internal";
const studentEmailOf = (rosterId) => `${rosterId}@${STUDENT_EMAIL_DOMAIN}`;

// BTC = tài khoản Auth có email THẬT (không phải email giả cấp cho học viên) — cùng quy tắc đang
// dùng trong firestore.rules, để nhất quán.
async function requireAdmin(auth, idToken) {
  if (!idToken) throw new Error("Thiếu idToken.");
  const decoded = await auth.verifyIdToken(idToken);
  if (!decoded.email || decoded.email.endsWith(`@${STUDENT_EMAIL_DOMAIN}`)) {
    throw new Error("Không có quyền BTC.");
  }
  return decoded; // decoded.email, decoded.uid
}

async function logAudit(db, action, adminEmail, detail) {
  try {
    await db.collection("auditLog").add({
      action, adminEmail, detail, timestamp: Date.now(),
    });
  } catch (e) { /* audit log lỗi không được chặn thao tác chính */ }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Chỉ hỗ trợ POST." });
    return;
  }
  const { action, idToken, rosterId, password, newPassword } = req.body || {};

  // TẠM THỜI (phục vụ gỡ lỗi): tách riêng từng giai đoạn — khởi tạo Admin SDK / xác thực BTC / xử lý
  // action — và gắn nhãn [INIT]/[AUTH]/[ACTION] vào đầu thông báo lỗi, để biết chính xác đang kẹt ở
  // đâu ngay trên giao diện app (khung đỏ), không cần vào Vercel Logs mò nữa.
  let auth, db;
  try {
    ({ auth, db } = await ensureInitialized());
  } catch (err) {
    res.status(500).json({ error: `[INIT] ${err && err.message ? err.message : String(err)}` });
    return;
  }

  let admin_;
  try {
    admin_ = await requireAdmin(auth, idToken);
  } catch (err) {
    res.status(403).json({ error: `[AUTH] ${err && err.message ? err.message : String(err)}` });
    return;
  }

  try {
    if (action === "create-student") {
      if (!rosterId || !password) throw new Error("Thiếu rosterId hoặc password.");
      const email = studentEmailOf(rosterId);
      let uid;
      try {
        const existing = await auth.getUserByEmail(email);
        uid = existing.uid; // đã có rồi (BTC bấm lại) — không tạo trùng
      } catch (e) {
        if (e.code !== "auth/user-not-found") throw e;
        const created = await auth.createUser({ email, password, emailVerified: true });
        uid = created.uid;
      }
      await logAudit(db, "create-student", admin_.email, { rosterId });
      res.status(200).json({ ok: true, uid });
      return;
    }

    if (action === "reset-password") {
      if (!rosterId || !newPassword) throw new Error("Thiếu rosterId hoặc newPassword.");
      const user = await auth.getUserByEmail(studentEmailOf(rosterId));
      await auth.updateUser(user.uid, { password: newPassword });
      await logAudit(db, "reset-password", admin_.email, { rosterId });
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "delete-student") {
      if (!rosterId) throw new Error("Thiếu rosterId.");
      try {
        const user = await auth.getUserByEmail(studentEmailOf(rosterId));
        await auth.deleteUser(user.uid);
      } catch (e) {
        if (e.code !== "auth/user-not-found") throw e; // đã xóa từ trước — coi như thành công
      }
      await logAudit(db, "delete-student", admin_.email, { rosterId });
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: `[ACTION] Không hỗ trợ action "${action}".` });
  } catch (err) {
    res.status(500).json({ error: `[ACTION] ${err && err.message ? err.message : String(err)}` });
  }
}
