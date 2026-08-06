# Ứng dụng Cán bộ mới TSC — VietinBank

Ứng dụng check-in "Khung năng lực & 7 Thói quen làm việc hiệu quả" — bản độc lập
(không cần đăng nhập Claude), dùng Firebase để lưu dữ liệu.

## Bước 1 — Điền cấu hình Firebase

Mở file `src/firebase.js`, thay các dòng `"DÁN_..._VÀO_ĐÂY"` bằng đúng giá trị
Firebase config bạn lấy từ Firebase Console (Project settings → General →
"Your apps" → SDK setup and configuration).

Trong Firebase Console, vào **Firestore Database → Rules**, dán đúng nội dung sau rồi bấm Publish:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

> Lưu ý: cấu hình này cho phép bất kỳ ai biết Firebase config đều đọc/ghi được
> dữ liệu — phù hợp cho bản pilot nội bộ (không chứa dữ liệu nhạy cảm), nhưng
> **không dùng cho hệ thống chính thức có dữ liệu quan trọng** nếu chưa siết
> lại quyền truy cập.

## Bước 2 — Đưa code lên GitHub

Nếu chưa có Git trên máy, cài đặt tại https://git-scm.com, sau đó mở
Terminal (macOS) hoặc Git Bash (Windows) tại thư mục này và chạy:

```bash
git init
git add .
git commit -m "Ứng dụng CBM - bản đầu tiên"
```

Vào https://github.com → **New repository** → đặt tên (VD: `vietinbank-cbm-app`)
→ **Create repository** (không cần tick "Add README"). GitHub sẽ hiện sẵn các
lệnh, dạng gần giống:

```bash
git remote add origin https://github.com/<tên-tài-khoản>/vietinbank-cbm-app.git
git branch -M main
git push -u origin main
```

## Bước 3 — Deploy lên Vercel

1. Vào https://vercel.com → đăng nhập bằng tài khoản GitHub.
2. Bấm **Add New → Project**.
3. Chọn đúng repo `vietinbank-cbm-app` vừa tạo → **Import**.
4. Vercel tự nhận đây là project Vite, để nguyên cấu hình mặc định → bấm **Deploy**.
5. Chờ khoảng 1 phút, Vercel trả về link dạng
   `https://vietinbank-cbm-app.vercel.app` — đây là link công khai, **ai bấm
   vào cũng dùng được ngay, không cần đăng nhập Claude hay bất kỳ tài khoản nào**.

## Cập nhật sau này

Mỗi khi cần sửa thêm tính năng, gửi lại yêu cầu để cập nhật file trong
`src/App.jsx`, sau đó chạy:

```bash
git add .
git commit -m "Cập nhật tính năng"
git push
```

Vercel sẽ **tự động deploy lại** mỗi khi bạn `git push` — không cần làm lại
từ đầu.

## Chạy thử trên máy trước khi đưa lên GitHub (tuỳ chọn)

```bash
npm install
npm run dev
```

Mở link hiện ra (thường là `http://localhost:5173`) để xem thử.
