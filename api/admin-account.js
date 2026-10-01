// Vercel Serverless Function — chạy Firebase Admin SDK phía SERVER (không bao giờ lộ ra trình
// duyệt). Đây là "backend nhẹ" cho Mức 2: cho phép BTC tạo/đổi mật khẩu/xóa tài khoản Firebase Auth
// THẬT của học viên NGAY TRONG APP, thay vì phải tự chạy script trên máy.
//
// Dùng gói Vercel Hobby (miễn phí) + Firebase Spark (miễn phí) — Admin SDK không tính phí theo gói,
// các lệnh createUser/updateUser/deleteUser luôn miễn phí trên mọi gói Firebase.
//
// CÀI ĐẶT (làm 1 lần, trên Vercel Dashboard của project canbomoitsc-v2):
//   1. Firebase Console → Project settings → Service accounts → "Generate new private key"
//      → mở file .json vừa tải, copy 3 giá trị sau vào Vercel → Project → Settings →
//      Environment Variables:
//        FIREBASE_PROJECT_ID    = project_id trong file json
//        FIREBASE_CLIENT_EMAIL  = client_email trong file json
//        FIREBASE_PRIVATE_KEY   = private_key trong file json (dán NGUYÊN VĂN, giữ các \n)
//   2. npm install firebase-admin (thêm vào package.json của repo chính, KHÔNG phải file riêng)
//   3. git push — Vercel tự deploy, route sẽ chạy tại /api/admin-account
//
// Không đưa file service-account .json lên Git — chỉ dùng để copy giá trị vào Environment Variables
// rồi xóa khỏi máy.

import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

const auth = admin.auth();
const db = admin.firestore();

const STUDENT_EMAIL_DOMAIN = "cbm-app.internal";
const studentEmailOf = (rosterId) => `${rosterId}@${STUDENT_EMAIL_DOMAIN}`;

// BTC = tài khoản Auth có email THẬT (không phải email giả cấp cho học viên) — cùng quy tắc đang
// dùng trong firestore.rules, để nhất quán.
async function requireAdmin(idToken) {
  if (!idToken) throw new Error("Thiếu idToken.");
  const decoded = await auth.verifyIdToken(idToken);
  if (!decoded.email || decoded.email.endsWith(`@${STUDENT_EMAIL_DOMAIN}`)) {
    throw new Error("Không có quyền BTC.");
  }
  return decoded; // decoded.email, decoded.uid
}

async function logAudit(action, adminEmail, detail) {
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
  try {
    const admin_ = await requireAdmin(idToken);

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
      await logAudit("create-student", admin_.email, { rosterId });
      res.status(200).json({ ok: true, uid });
      return;
    }

    if (action === "reset-password") {
      if (!rosterId || !newPassword) throw new Error("Thiếu rosterId hoặc newPassword.");
      const user = await auth.getUserByEmail(studentEmailOf(rosterId));
      await auth.updateUser(user.uid, { password: newPassword });
      await logAudit("reset-password", admin_.email, { rosterId });
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
      await logAudit("delete-student", admin_.email, { rosterId });
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: `Không hỗ trợ action "${action}".` });
  } catch (err) {
    res.status(403).json({ error: err.message || "Lỗi xác thực/quyền." });
  }
}
