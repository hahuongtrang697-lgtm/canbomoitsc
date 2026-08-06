import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import {
  Flame, Trophy, Plus, Clock, BarChart3, LogOut, Heart, Download, X, ChevronRight,
  Sunrise, AlertCircle, Check, Mail, Lock, Upload, UserPlus, KeyRound, Ban, Trash2,
  Menu, LayoutDashboard, Users2, Home as HomeIcon,
} from "lucide-react";
import { storage } from "./firebase.js";

// ---------- Domain constants (PRD v1.1) ----------
const CATEGORY_GROUPS = [
  { group: "Khung năng lực", items: ["Chính trực", "Trí tuệ", "Tận tâm", "Thấu cảm", "Thích ứng"] },
  {
    group: "Thói quen làm việc hiệu quả",
    items: [
      "Thói quen 1: Luôn chủ động",
      "Thói quen 2: Bắt đầu với đích đến",
      "Thói quen 3: Ưu tiên việc quan trọng",
      "Thói quen 5: Thấu hiểu rồi được hiểu",
    ],
  },
];

const ADMIN_PIN = "btc2026";
const PROGRAM_DAYS = 10;
// Màu thương hiệu VietinBank chính thức
const BLUE = "#005993";       // Vietin Dark Blue
const RED = "#D71249";        // Vietin Red
const LIGHT_BLUE = "#7ED3F7"; // Vietin Light Blue

const BrandStyles = () => (
  <style>{`
    .brand-bg { background-color: ${BLUE}; }
    .accent-bg { background-color: ${RED}; }
    .app-bg { background-color: #F7F9FC; }
    .brand-text { color: ${BLUE}; }
    .accent-text { color: ${RED}; }
    .gold-text { color: #C79A1E; }
    .success-text { color: #1F9D6B; }
    .accent-fill { fill: ${RED}; }
    .brand-hover-text:hover { color: ${BLUE}; }
    .accent-hover-text:hover { color: ${RED}; }
    .brand-ring-2 { box-shadow: 0 0 0 2px ${BLUE}; }
    .brand-focus-border:focus { border-color: ${BLUE}; }
    .brand-focus:focus { border-color: ${BLUE}; box-shadow: 0 0 0 3px rgba(0,89,147,0.15); }
    .brand-hero { background: linear-gradient(135deg, ${BLUE} 0%, #003E68 100%); }
    .brand-avatar { background: linear-gradient(135deg, ${BLUE} 0%, #0072AD 100%); }
    .light-blue-bg { background-color: ${LIGHT_BLUE}; }
    .light-blue-tint-bg { background-color: rgba(126,211,247,0.15); }
  `}</style>
);

// ---------- Helpers ----------
const dayKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const todayKey = () => dayKey(Date.now());
const fmtDate = (ts) => {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const fmtTime = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const uid = () => Math.random().toString(36).slice(2, 10);
const normEmail = (s) => (s || "").trim().toLowerCase();

function computeUserStats(userEntries, earlyBirdDayMap) {
  if (userEntries.length === 0) return { points: 0, streak: 0, longestStreak: 0, daysLogged: 0 };
  const days = [...new Set(userEntries.map((e) => dayKey(e.timestamp)))].sort();
  let points = 0, curStreak = 0, longestStreak = 0, prevDay = null;
  days.forEach((d) => {
    if (prevDay === null) curStreak = 1;
    else {
      const gap = daysBetween(prevDay, d);
      if (gap === 1) curStreak += 1;
      else {
        if (gap - 1 >= 2) points -= 1;
        curStreak = 1;
      }
    }
    if (curStreak % 3 === 0) points += 3;
    longestStreak = Math.max(longestStreak, curStreak);
    prevDay = d;
  });
  points += userEntries.length;
  userEntries.forEach((e) => {
    const d = dayKey(e.timestamp);
    if ((earlyBirdDayMap[d] || []).includes(e.id)) points += 1;
  });
  const lastDay = days[days.length - 1];
  const activeStreak = daysBetween(lastDay, todayKey()) <= 1 ? curStreak : 0;
  return { points, streak: activeStreak, longestStreak, daysLogged: days.length };
}

function earlyBirdMapForDay(entries) {
  const byDay = {};
  entries.forEach((e) => { const d = dayKey(e.timestamp); byDay[d] = byDay[d] || []; byDay[d].push(e); });
  const map = {};
  Object.entries(byDay).forEach(([d, list]) => {
    const firstPerUser = {};
    list.forEach((e) => { if (!firstPerUser[e.userId] || e.timestamp < firstPerUser[e.userId].timestamp) firstPerUser[e.userId] = e; });
    map[d] = Object.values(firstPerUser).sort((a, b) => a.timestamp - b.timestamp).slice(0, 5).map((e) => e.id);
  });
  return map;
}

// Gộp roster + entries thành danh sách kèm điểm/streak/số ngày bỏ lỡ liên tiếp gần nhất
function buildRosterStats(roster, entries, earlyMap) {
  const byUser = {};
  entries.forEach((e) => { byUser[e.userId] = byUser[e.userId] || []; byUser[e.userId].push(e); });
  return roster.map((u) => {
    const list = (byUser[u.id] || []).sort((a, b) => a.timestamp - b.timestamp);
    const stats = computeUserStats(list, earlyMap);
    const lastDay = list.length ? dayKey(list[list.length - 1].timestamp) : null;
    const missedDays = lastDay ? daysBetween(lastDay, todayKey()) : null; // null = chưa từng ứng dụng
    return { ...u, ...stats, missedDays };
  });
}

// ---------- UI atoms ----------
const Avatar = ({ name, size = 40 }) => {
  const initials = (name || "?").trim().split(/\s+/).slice(-2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div style={{ width: size, height: size, fontSize: size * 0.38 }}
      className="rounded-full brand-avatar text-white flex items-center justify-center font-semibold shrink-0">
      {initials}
    </div>
  );
};
const Pill = ({ children, tone = "blue" }) => {
  const tones = { blue: "bg-blue-50 brand-text", red: "bg-red-50 accent-text", gray: "bg-gray-100 text-gray-600" };
  return <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${tones[tone]}`}>{children}</span>;
};
const Card = ({ children, className = "" }) => (
  <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm ${className}`}>{children}</div>
);
const Field = ({ icon: Icon, ...props }) => (
  <div className="relative">
    {Icon && <Icon size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />}
    <input {...props} className={`w-full border border-gray-200 rounded-xl py-3 text-[15px] outline-none brand-focus ${Icon ? "pl-10 pr-3.5" : "px-3.5"}`} />
  </div>
);

// ---------- Login ----------
function LoginScreen({ roster, onLogin, onAdminLogin }) {
  const [mode, setMode] = useState("student");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [classCode, setClassCode] = useState("");
  const [error, setError] = useState("");

  const existingClasses = useMemo(() => [...new Set(roster.map((u) => u.classCode).filter(Boolean))], [roster]);

  const submitStudent = () => {
    const acc = roster.find((u) => normEmail(u.email) === normEmail(email));
    if (!acc) { setError("Email hoặc mật khẩu không đúng."); return; }
    if (acc.locked) { setError("Tài khoản đã bị khóa. Vui lòng liên hệ Ban tổ chức."); return; }
    if (acc.password !== password) { setError("Email hoặc mật khẩu không đúng."); return; }
    onLogin(acc);
  };
  const submitAdmin = () => {
    if (pin !== ADMIN_PIN) { setError("Mã Ban tổ chức không đúng."); return; }
    if (!classCode.trim()) { setError("Vui lòng nhập Mã lớp bạn muốn quản lý."); return; }
    onAdminLogin(classCode.trim());
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-10 brand-hero">
      <div className="max-w-sm w-full">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center mx-auto mb-4">
            <Flame className="gold-text" size={30} />
          </div>
          <h1 className="text-white text-xl font-bold leading-snug">Ứng dụng Khung năng lực &amp; 7 Thói quen làm việc hiệu quả</h1>
          <p className="text-blue-100 text-sm mt-1.5">Lớp Cán bộ mới TSC VietinBank</p>
        </div>

        <Card className="p-5">
          <div className="flex gap-2 mb-5 bg-gray-100 rounded-xl p-1">
            <button onClick={() => { setMode("student"); setError(""); }} className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${mode === "student" ? "bg-white shadow brand-text" : "text-gray-500"}`}>Học viên</button>
            <button onClick={() => { setMode("admin"); setError(""); }} className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${mode === "admin" ? "bg-white shadow brand-text" : "text-gray-500"}`}>Ban tổ chức</button>
          </div>

          {mode === "student" ? (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Email</label>
                <Field icon={Mail} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vd: email@vietinbank.vn" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Mật khẩu</label>
                <Field icon={Lock} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mật khẩu được cấp" onKeyDown={(e) => e.key === "Enter" && submitStudent()} />
              </div>
              {error && <p className="accent-text text-xs">{error}</p>}
              <button onClick={submitStudent} className="w-full brand-bg text-white font-semibold py-3.5 rounded-xl active:scale-[0.98] transition mt-1">Đăng nhập</button>
              <p className="text-[11px] text-gray-400 text-center pt-1">Tài khoản do Ban tổ chức cấp trước. Liên hệ Ban tổ chức nếu chưa có tài khoản.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Mã truy cập Ban tổ chức</label>
                <Field icon={Lock} type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Nhập mã" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Mã lớp bạn muốn quản lý</label>
                <Field value={classCode} onChange={(e) => setClassCode(e.target.value)} placeholder="VD: CBM-K15" onKeyDown={(e) => e.key === "Enter" && submitAdmin()} />
                {existingClasses.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {existingClasses.map((c) => (
                      <button key={c} onClick={() => setClassCode(c)} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200">{c}</button>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-gray-400 mt-1.5">Nhập mã lớp đã có ở trên, hoặc gõ mã mới để tạo lớp mới.</p>
              </div>
              {error && <p className="accent-text text-xs">{error}</p>}
              <button onClick={submitAdmin} className="w-full accent-bg text-white font-semibold py-3.5 rounded-xl active:scale-[0.98] transition mt-1">Vào Dashboard</button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------- Add entry ----------
function AddEntryScreen({ onSave, onClose }) {
  const [group, setGroup] = useState(CATEGORY_GROUPS[0].group);
  const [item, setItem] = useState(CATEGORY_GROUPS[0].items[0]);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const items = CATEGORY_GROUPS.find((g) => g.group === group)?.items || [];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end md:items-center justify-center z-40" onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-t-3xl md:rounded-3xl p-5 pb-7 max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg text-gray-900">+ Thêm ứng dụng</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center"><X size={16} /></button>
        </div>
        <label className="text-xs font-medium text-gray-500 mb-1 block">Danh mục</label>
        <select value={group} onChange={(e) => { setGroup(e.target.value); setItem(CATEGORY_GROUPS.find((g) => g.group === e.target.value).items[0]); }}
          className="w-full border border-gray-200 rounded-xl px-3.5 py-3 text-[15px] mb-3 outline-none brand-focus-border">
          {CATEGORY_GROUPS.map((g) => <option key={g.group} value={g.group}>{g.group}</option>)}
        </select>
        <select value={item} onChange={(e) => setItem(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3.5 py-3 text-[15px] mb-3 outline-none brand-focus-border">
          {items.map((it) => <option key={it} value={it}>{it}</option>)}
        </select>
        <label className="text-xs font-medium text-gray-500 mb-1 block">Nội dung ứng dụng</label>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder='VD: "Hôm nay tôi chủ động gọi điện trước cho khách hàng để xác nhận hồ sơ."'
          rows={4} className="w-full border border-gray-200 rounded-xl px-3.5 py-3 text-[15px] outline-none brand-focus-border resize-none" />
        {error && <p className="accent-text text-xs mt-2">{error}</p>}
        <button onClick={() => { if (!content.trim()) { setError("Vui lòng nhập nội dung ứng dụng."); return; } onSave({ group, item, content: content.trim() }); }}
          className="w-full brand-bg text-white font-semibold py-3.5 rounded-xl mt-4 active:scale-[0.98] transition">Lưu</button>
      </div>
    </div>
  );
}

// ---------- Home ----------
function HomeScreen({ user, entries, roster, onOpenAdd, onLike }) {
  const myEntries = useMemo(() => entries.filter((e) => e.userId === user.id).sort((a, b) => a.timestamp - b.timestamp), [entries, user.id]);
  const earlyMap = useMemo(() => earlyBirdMapForDay(entries), [entries]);
  const myStats = useMemo(() => computeUserStats(myEntries, earlyMap), [myEntries, earlyMap]);
  const doneToday = myEntries.some((e) => dayKey(e.timestamp) === todayKey());

  const allStats = useMemo(() => buildRosterStats(roster, entries, earlyMap), [entries, roster, earlyMap]);

  const leaderboard = useMemo(() => [...allStats].sort((a, b) => b.points - a.points).slice(0, 5), [allStats]);
  const myRank = useMemo(() => [...allStats].sort((a, b) => b.points - a.points).findIndex((u) => u.id === user.id) + 1, [allStats, user.id]);
  const todaysEarlyBird = useMemo(() => (earlyMap[todayKey()] || []).map((id) => entries.find((e) => e.id === id)).filter(Boolean), [earlyMap, entries]);
  const latest10 = useMemo(() => [...entries].sort((a, b) => b.timestamp - a.timestamp).slice(0, 10), [entries]);
  // Top 5 người đã 2 ngày liên tiếp trở lên chưa ứng dụng (ưu tiên người chưa từng ứng dụng, sau đó theo số ngày bỏ lỡ nhiều nhất)
  const missingList = useMemo(() => {
    return [...allStats]
      .filter((u) => u.missedDays === null || u.missedDays >= 2)
      .sort((a, b) => (b.missedDays === null ? 9999 : b.missedDays) - (a.missedDays === null ? 9999 : a.missedDays))
      .slice(0, 5);
  }, [allStats]);

  return (
    <div className="pb-24 md:pb-8">
      <div className="brand-hero px-5 md:px-8 pt-6 md:pt-8 pb-8 md:pb-10 md:rounded-3xl text-white">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm">Xin chào 👋 · Lớp {user.classCode}</p>
              <h1 className="text-xl md:text-2xl font-bold">{user.name}</h1>
            </div>
            <Avatar name={user.name} size={44} />
          </div>
          {doneToday ? (
            <div className="mt-4 bg-white/15 backdrop-blur rounded-xl px-4 py-3 flex items-center gap-2 text-sm max-w-md">
              <Check size={16} className="success-text" /> Bạn đã ghi nhận ứng dụng hôm nay
            </div>
          ) : (
            <div className="mt-4 bg-white/15 backdrop-blur rounded-xl px-4 py-3 flex items-center gap-2 text-sm max-w-md">
              <AlertCircle size={16} className="gold-text" /> Bạn chưa ghi nhận ứng dụng hôm nay
            </div>
          )}
          <div className="flex items-center gap-2 mt-3 text-amber-200 text-sm font-medium">
            <Flame size={18} /> Bạn đã duy trì {myStats.streak} ngày liên tiếp
          </div>
          <button onClick={onOpenAdd} className="w-full md:w-auto bg-white brand-text font-semibold py-3.5 px-6 rounded-xl mt-4 flex items-center justify-center gap-2 active:scale-[0.98] transition">
            <Plus size={18} /> Thêm ứng dụng ngay
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-5 md:px-8 -mt-4 md:mt-6">
        <Card className="p-4 grid grid-cols-3 divide-x divide-gray-100 md:max-w-xl">
          <div className="text-center px-1"><p className="text-lg font-bold text-gray-900">{myStats.daysLogged}/{PROGRAM_DAYS}</p><p className="text-[11px] text-gray-500 mt-0.5">Ngày đã làm</p></div>
          <div className="text-center px-1"><p className="text-lg font-bold text-gray-900">#{myRank || "-"}</p><p className="text-[11px] text-gray-500 mt-0.5">Xếp hạng</p></div>
          <div className="text-center px-1"><p className="text-lg font-bold text-gray-900">{myStats.points}</p><p className="text-[11px] text-gray-500 mt-0.5">Điểm</p></div>
        </Card>
      </div>

      <div className="max-w-6xl mx-auto px-5 md:px-8 mt-5 grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 space-y-5">
          <div>
            <div className="flex items-center gap-2 mb-3"><Sunrise size={16} className="text-amber-500" /><h3 className="font-semibold text-gray-900 text-sm">Top 5 Early Bird hôm nay</h3></div>
            <Card className="p-3">
              {todaysEarlyBird.length === 0 ? <p className="text-sm text-gray-400 py-2 text-center">Chưa có ai ứng dụng hôm nay. Hãy là người đầu tiên!</p> : (
                <div className="space-y-2.5">
                  {todaysEarlyBird.map((e, i) => (
                    <div key={e.id} className="flex items-center gap-3">
                      <span className="text-lg w-6">{["🥇", "🥈", "🥉", "4️⃣", "5️⃣"][i]}</span>
                      <Avatar name={e.userName} size={30} />
                      <span className="flex-1 text-sm font-medium text-gray-800">{e.userName}</span>
                      <span className="text-xs text-gray-400">{fmtTime(e.timestamp)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div>
            <h3 className="font-semibold text-gray-900 text-sm mb-3">🆕 10 ứng dụng mới nhất</h3>
            <div className="space-y-2.5 md:grid md:grid-cols-2 md:gap-3 md:space-y-0">
              {latest10.length === 0 && <p className="text-sm text-gray-400 py-2">Chưa có bài ứng dụng nào.</p>}
              {latest10.map((e) => (
                <Card key={e.id} className="p-3.5">
                  <div className="flex items-center gap-2.5 mb-2">
                    <Avatar name={e.userName} size={30} />
                    <div className="flex-1 min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{e.userName}</p><p className="text-[11px] text-gray-400">{e.dept} · {fmtDate(e.timestamp)} {fmtTime(e.timestamp)}</p></div>
                    <Pill tone="blue">{e.item.replace(/^Thói quen \d: /, "")}</Pill>
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed">{e.content}</p>
                  <div className="flex items-center gap-4 mt-2.5 pt-2.5 border-t border-gray-50">
                    <button onClick={() => onLike(e.id)} className="flex items-center gap-1 text-xs text-gray-400 accent-hover-text">
                      <Heart size={14} className={(e.likes || []).includes(user.id) ? "accent-fill accent-text" : ""} /> {(e.likes || []).length}
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:sticky lg:top-6">
          <div className="flex items-center gap-2 mb-3"><Trophy size={16} className="text-amber-500" /><h3 className="font-semibold text-gray-900 text-sm">Top 5 cá nhân điểm cao nhất</h3></div>
          <Card className="p-3 mb-5">
            <div className="space-y-2.5">
              {leaderboard.length === 0 && <p className="text-sm text-gray-400 py-2 text-center">Chưa có dữ liệu.</p>}
              {leaderboard.map((u, i) => (
                <div key={u.id} className="flex items-center gap-3">
                  <span className="text-sm w-6 font-semibold text-gray-400">{i + 1}</span>
                  <Avatar name={u.name} size={30} />
                  <div className="flex-1 min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{u.name}</p><p className="text-[11px] text-gray-400 truncate">{u.dept}</p></div>
                  <span className="text-sm font-bold brand-text">{u.points}đ</span>
                </div>
              ))}
            </div>
          </Card>

          <div className="flex items-center gap-2 mb-3"><AlertCircle size={16} className="accent-text" /><h3 className="font-semibold text-gray-900 text-sm">Top 5 người 2 ngày liên tiếp chưa ứng dụng</h3></div>
          <Card className="p-3">
            <div className="space-y-2.5">
              {missingList.length === 0 && <p className="text-sm text-gray-400 py-2 text-center">Cả lớp đang ứng dụng đều đặn, không có ai bỏ lỡ 🎉</p>}
              {missingList.map((u) => (
                <div key={u.id} className="flex items-center gap-3">
                  <Avatar name={u.name} size={30} />
                  <div className="flex-1 min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{u.name}</p><p className="text-[11px] text-gray-400 truncate">{u.dept}</p></div>
                  <span className="text-xs accent-text font-medium whitespace-nowrap">{u.missedDays === null ? "Chưa từng ứng dụng" : `Bỏ ${u.missedDays} ngày`}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------- History ----------
function HistoryScreen({ user, entries }) {
  const myEntries = useMemo(() => entries.filter((e) => e.userId === user.id).sort((a, b) => b.timestamp - a.timestamp), [entries, user.id]);
  return (
    <div className="max-w-3xl mx-auto px-5 md:px-8 pt-6 pb-24 md:pb-8">
      <h1 className="text-lg font-bold text-gray-900 mb-4">Lịch sử ứng dụng của tôi</h1>
      {myEntries.length === 0 && <p className="text-sm text-gray-400">Bạn chưa có lượt ứng dụng nào.</p>}
      <div className="relative pl-5">
        <div className="absolute left-[7px] top-1 bottom-1 w-px bg-gray-200" />
        <div className="space-y-5">
          {myEntries.map((e) => (
            <div key={e.id} className="relative">
              <div className="absolute -left-5 top-1 w-3.5 h-3.5 rounded-full brand-bg border-2 border-white shadow" />
              <p className="text-xs font-semibold text-gray-400 mb-1">{fmtDate(e.timestamp)} · {fmtTime(e.timestamp)}</p>
              <Card className="p-3.5">
                <div className="flex items-center gap-2 mb-1.5"><Check size={14} className="text-emerald-500" /><Pill tone="blue">{e.item.replace(/^Thói quen \d: /, "")}</Pill></div>
                <p className="text-sm text-gray-700 leading-relaxed">{e.content}</p>
              </Card>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Leaderboard full ----------
function LeaderboardScreen({ entries, roster, currentUserId }) {
  const earlyMap = useMemo(() => earlyBirdMapForDay(entries), [entries]);
  const allStats = useMemo(() => {
    const byUser = {};
    entries.forEach((e) => { byUser[e.userId] = byUser[e.userId] || []; byUser[e.userId].push(e); });
    return roster.map((u) => {
      const list = (byUser[u.id] || []).sort((a, b) => a.timestamp - b.timestamp);
      return { ...u, ...computeUserStats(list, earlyMap) };
    }).sort((a, b) => b.points - a.points);
  }, [entries, roster, earlyMap]);

  return (
    <div className="max-w-3xl mx-auto px-5 md:px-8 pt-6 pb-24 md:pb-8">
      <h1 className="text-lg font-bold text-gray-900 mb-4">⚡ Bảng xếp hạng toàn lớp</h1>
      <div className="space-y-2">
        {allStats.map((u, i) => (
          <Card key={u.id} className={`p-3.5 flex items-center gap-3 ${u.id === currentUserId ? "brand-ring-2" : ""}`}>
            <span className={`text-sm w-7 font-bold ${i < 3 ? "text-amber-500" : "text-gray-400"}`}>{i + 1}</span>
            <Avatar name={u.name} size={34} />
            <div className="flex-1 min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{u.name}{u.id === currentUserId && " (bạn)"}</p><p className="text-[11px] text-gray-400 truncate">{u.dept} · {u.daysLogged} ngày · 🔥{u.streak}</p></div>
            <span className="text-sm font-bold brand-text">{u.points}đ</span>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------- Admin: Accounts management ----------
function AdminAccountsScreen({ roster, defaultPassword, classCode, onAdd, onBulkImport, onToggleLock, onResetPassword, onDelete, onDefaultPasswordChange }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [dept, setDept] = useState("");
  const [error, setError] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const fileRef = useRef(null);

  const addManual = () => {
    if (!name.trim() || !email.trim()) { setError("Vui lòng nhập họ tên và email."); return; }
    if (roster.some((u) => normEmail(u.email) === normEmail(email))) { setError("Email này đã tồn tại."); return; }
    onAdd({ name: name.trim(), email: email.trim(), dept: dept.trim() });
    setName(""); setEmail(""); setDept(""); setError("");
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportMsg("Đang nhập dữ liệu...");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      const pick = (row, keys) => { for (const k of keys) { const found = Object.keys(row).find((rk) => rk.toLowerCase().trim() === k); if (found && row[found]) return String(row[found]).trim(); } return ""; };
      const parsed = rows.map((row) => ({
        name: pick(row, ["họ tên", "ho ten", "name", "họ và tên"]),
        email: pick(row, ["email", "e-mail"]),
        dept: pick(row, ["đơn vị", "don vi", "dept", "phòng", "chi nhánh"]),
      })).filter((r) => r.email && r.name);
      if (parsed.length === 0) { setImportMsg("Không tìm thấy dữ liệu hợp lệ. Cần cột: Họ tên, Email, Đơn vị."); return; }
      const added = onBulkImport(parsed);
      setImportMsg(`Đã nhập ${added} tài khoản mới (bỏ qua email trùng).`);
    } catch (err) {
      setImportMsg("Không đọc được file. Vui lòng dùng file Excel (.xlsx).");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-5 md:px-8 pt-6 pb-24 md:pb-8">
      <h1 className="text-lg font-bold text-gray-900 mb-1">Quản lý tài khoản học viên</h1>
      <Pill tone="blue">Lớp {classCode}</Pill>
      <div className="mb-4" />

      <Card className="p-4 mb-5">
        <p className="text-sm font-medium text-gray-700 mb-2">Mật khẩu mặc định cấp cho tài khoản mới</p>
        <div className="flex gap-2">
          <Field value={defaultPassword} onChange={(e) => onDefaultPasswordChange(e.target.value)} placeholder="VD: cbm@2026" />
        </div>
        <p className="text-[11px] text-gray-400 mt-1.5">Áp dụng cho tài khoản thêm mới thủ công hoặc nhập từ Excel.</p>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <Card className="p-4">
          <p className="text-sm font-semibold text-gray-800 mb-1 flex items-center gap-1.5"><UserPlus size={15} /> Thêm 1 tài khoản</p>
          <p className="text-[11px] text-gray-400 mb-3">Sẽ được thêm vào <strong>Lớp {classCode}</strong></p>
          <div className="space-y-2.5">
            <Field placeholder="Họ và tên" value={name} onChange={(e) => setName(e.target.value)} />
            <Field placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Field placeholder="Đơn vị / Phòng" value={dept} onChange={(e) => setDept(e.target.value)} />
            {error && <p className="accent-text text-xs">{error}</p>}
            <button onClick={addManual} className="w-full brand-bg text-white font-semibold py-2.5 rounded-xl text-sm">Thêm tài khoản</button>
          </div>
        </Card>

        <Card className="p-4">
          <p className="text-sm font-semibold text-gray-800 mb-1 flex items-center gap-1.5"><Upload size={15} /> Nhập hàng loạt từ Excel</p>
          <p className="text-[11px] text-gray-400 mb-2">Sẽ được thêm vào <strong>Lớp {classCode}</strong></p>
          <p className="text-xs text-gray-500 mb-3">File cần có các cột: <strong>Họ tên, Email, Đơn vị</strong>.</p>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" id="import-file" />
          <label htmlFor="import-file" className="block w-full text-center bg-gray-100 text-gray-700 font-medium py-2.5 rounded-xl text-sm cursor-pointer hover:bg-gray-200">Chọn file Excel</label>
          {importMsg && <p className="text-xs text-gray-500 mt-2">{importMsg}</p>}
        </Card>
      </div>

      <p className="text-sm font-semibold text-gray-800 mb-2">Danh sách tài khoản lớp {classCode} ({roster.length})</p>
      <div className="space-y-2">
        {roster.length === 0 && <p className="text-sm text-gray-400">Chưa có tài khoản nào trong lớp này. Hãy thêm hoặc nhập từ Excel ở trên.</p>}
        {roster.map((u) => (
          <Card key={u.id} className="p-3.5 flex items-center gap-3">
            <Avatar name={u.name} size={32} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{u.name} {u.locked && <span className="text-[10px] accent-text font-normal">(đã khóa)</span>}</p>
              <p className="text-[11px] text-gray-400 truncate">{u.email} · {u.dept}</p>
            </div>
            <Pill tone="gray">Lớp {u.classCode}</Pill>
            <button onClick={() => onResetPassword(u.id)} title="Cấp lại mật khẩu mặc định" className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-gray-500 brand-hover-text"><KeyRound size={15} /></button>
            <button onClick={() => onToggleLock(u.id)} title={u.locked ? "Mở khóa" : "Khóa tài khoản"} className={`w-8 h-8 rounded-lg flex items-center justify-center ${u.locked ? "bg-red-50 accent-text" : "bg-gray-50 text-gray-500 accent-hover-text"}`}><Ban size={15} /></button>
            <button onClick={() => onDelete(u.id)} title="Xóa tài khoản" className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-gray-500 accent-hover-text"><Trash2 size={15} /></button>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------- Admin: Dashboard ----------
function AdminScreen({ entries, roster, classCode }) {
  const [selected, setSelected] = useState(null);
  const earlyMap = useMemo(() => earlyBirdMapForDay(entries), [entries]);
  const allStats = useMemo(() => {
    const byUser = {};
    entries.forEach((e) => { byUser[e.userId] = byUser[e.userId] || []; byUser[e.userId].push(e); });
    return roster.map((u) => {
      const list = (byUser[u.id] || []).sort((a, b) => a.timestamp - b.timestamp);
      const stats = computeUserStats(list, earlyMap);
      const lastDay = list.length ? dayKey(list[list.length - 1].timestamp) : null;
      const missedDays = lastDay ? daysBetween(lastDay, todayKey()) : null;
      return { ...u, ...stats, list, missedDays };
    }).sort((a, b) => b.points - a.points);
  }, [entries, roster, earlyMap]);

  const doneToday = allStats.filter((u) => u.list.some((e) => dayKey(e.timestamp) === todayKey()));
  const notDoneToday = allStats.filter((u) => !u.list.some((e) => dayKey(e.timestamp) === todayKey()));
  const completionRate = roster.length ? Math.round((doneToday.length / roster.length) * 100) : 0;

  const exportExcel = () => {
    const rows = entries.slice().sort((a, b) => a.timestamp - b.timestamp).map((e) => {
      const u = allStats.find((x) => x.id === e.userId);
      return {
        "Tên": e.userName, "Email": u ? u.email : "", "Đơn vị": e.dept,
        "Điểm (tổng)": u ? u.points : "", "Số ngày ứng dụng": u ? u.daysLogged : "",
        "Early Bird": (earlyMap[dayKey(e.timestamp)] || []).includes(e.id) ? "Có" : "",
        "Thời gian nhập": new Date(e.timestamp).toLocaleString("vi-VN"),
        "Danh mục": e.group, "Nội dung ứng dụng": e.content,
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 20 }, { wch: 22 }, { wch: 20 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 18 }, { wch: 26 }, { wch: 50 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ứng dụng sau đào tạo");
    XLSX.writeFile(wb, `bao-cao-ung-dung-${todayKey()}.xlsx`);
  };

  if (selected) {
    const u = allStats.find((x) => x.id === selected);
    return (
      <div className="max-w-3xl mx-auto px-5 md:px-8 pt-6 pb-24 md:pb-8">
        <button onClick={() => setSelected(null)} className="text-sm brand-text font-medium mb-4">← Quay lại</button>
        <div className="flex items-center gap-3 mb-4">
          <Avatar name={u.name} size={48} />
          <div><h1 className="font-bold text-gray-900">{u.name}</h1><p className="text-xs text-gray-400">{u.email} · {u.dept}</p></div>
        </div>
        <Card className="p-4 grid grid-cols-3 divide-x divide-gray-100 mb-5">
          <div className="text-center"><p className="text-lg font-bold">{u.points}</p><p className="text-[11px] text-gray-500">Điểm</p></div>
          <div className="text-center"><p className="text-lg font-bold">{u.daysLogged}</p><p className="text-[11px] text-gray-500">Ngày làm</p></div>
          <div className="text-center"><p className="text-lg font-bold">{u.streak}🔥</p><p className="text-[11px] text-gray-500">Streak</p></div>
        </Card>
        <h3 className="font-semibold text-sm text-gray-900 mb-2">Lịch sử &amp; minh chứng</h3>
        <div className="space-y-2.5">
          {u.list.slice().reverse().map((e) => (
            <Card key={e.id} className="p-3.5">
              <p className="text-xs text-gray-400 mb-1">{fmtDate(e.timestamp)} {fmtTime(e.timestamp)} · {e.item}</p>
              <p className="text-sm text-gray-700">{e.content}</p>
            </Card>
          ))}
          {u.list.length === 0 && <p className="text-sm text-gray-400">Chưa có dữ liệu.</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-5 md:px-8 pt-6 pb-24 md:pb-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Dashboard Ban tổ chức</h1>
          <Pill tone="blue">Lớp {classCode}</Pill>
        </div>
        <button onClick={exportExcel} className="flex items-center gap-1.5 brand-bg text-white text-xs font-semibold px-3 py-2 rounded-lg"><Download size={14} /> Xuất Excel</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Card className="p-4"><p className="text-2xl font-bold text-gray-900">{roster.length}</p><p className="text-xs text-gray-500 mt-1">Tổng học viên</p></Card>
        <Card className="p-4"><p className="text-2xl font-bold text-emerald-600">{doneToday.length}</p><p className="text-xs text-gray-500 mt-1">Đã nhập hôm nay</p></Card>
        <Card className="p-4"><p className="text-2xl font-bold accent-text">{notDoneToday.length}</p><p className="text-xs text-gray-500 mt-1">Chưa nhập hôm nay</p></Card>
        <Card className="p-4"><p className="text-2xl font-bold brand-text">{completionRate}%</p><p className="text-xs text-gray-500 mt-1">Tỷ lệ hoàn thành</p></Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <h3 className="font-semibold text-sm text-gray-900 mb-2 flex items-center gap-1.5"><AlertCircle size={15} className="accent-text" /> Chưa nhập hôm nay</h3>
          <div className="space-y-2">
            {notDoneToday.length === 0 && <p className="text-sm text-gray-400">Tất cả học viên đã nhập hôm nay 🎉</p>}
            {notDoneToday.map((u) => (
              <button key={u.id} onClick={() => setSelected(u.id)} className="w-full text-left">
                <Card className="p-3 flex items-center gap-3">
                  <Avatar name={u.name} size={30} />
                  <div className="flex-1 min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{u.name}</p><p className="text-[11px] text-gray-400 truncate">{u.dept}</p></div>
                  <span className="text-xs accent-text font-medium">{u.missedDays !== null ? `Bỏ ${u.missedDays} ngày` : "Chưa bắt đầu"}</span>
                  <ChevronRight size={16} className="text-gray-300" />
                </Card>
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-sm text-gray-900 mb-2">Theo dõi cá nhân · Toàn lớp</h3>
          <div className="space-y-2">
            {allStats.map((u, i) => (
              <button key={u.id} onClick={() => setSelected(u.id)} className="w-full text-left">
                <Card className="p-3 flex items-center gap-3">
                  <span className="text-xs w-5 font-semibold text-gray-400">{i + 1}</span>
                  <Avatar name={u.name} size={30} />
                  <div className="flex-1 min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{u.name}</p><p className="text-[11px] text-gray-400 truncate">{u.dept}</p></div>
                  <span className="text-sm font-bold brand-text">{u.points}đ</span>
                  <ChevronRight size={16} className="text-gray-300" />
                </Card>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Nav ----------
const STUDENT_NAV = [
  { id: "home", label: "Trang chủ", icon: HomeIcon },
  { id: "history", label: "Lịch sử", icon: Clock },
  { id: "leaderboard", label: "Xếp hạng", icon: Trophy },
];
const ADMIN_NAV = [
  { id: "admin", label: "Dashboard", icon: LayoutDashboard },
  { id: "accounts", label: "Tài khoản", icon: Users2 },
];

function BottomNav({ view, setView, items }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-2 py-2 flex justify-around md:hidden z-20">
      {items.map((it) => {
        const Icon = it.icon, active = view === it.id;
        return (
          <button key={it.id} onClick={() => setView(it.id)} className={`flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl transition ${active ? "brand-text" : "text-gray-400"}`}>
            <Icon size={20} /><span className="text-[10px] font-medium">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Sidebar({ view, setView, items, user, onLogout, existingClasses = [], onSwitchClass }) {
  const [switching, setSwitching] = useState(false);
  const [newClass, setNewClass] = useState("");
  return (
    <div className="hidden md:flex flex-col w-60 shrink-0 bg-white border-r border-gray-100 min-h-screen sticky top-0">
      <div className="px-5 py-6 flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl brand-bg flex items-center justify-center"><Flame className="gold-text" size={18} /></div>
        <div>
          <p className="font-bold text-gray-900 text-sm leading-tight">Ứng dụng Cán bộ mới TSC</p>
          <p className="text-[10px] text-gray-400">VietinBank</p>
        </div>
      </div>

      {user.isAdmin && (
        <div className="px-4 pb-3">
          <p className="text-[10px] font-medium text-gray-400 uppercase mb-1">Đang quản lý lớp</p>
          {!switching ? (
            <button onClick={() => setSwitching(true)} className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-blue-50 brand-text text-sm font-semibold">
              {user.classCode} <span className="text-[11px] font-normal">Đổi</span>
            </button>
          ) : (
            <div className="space-y-1.5">
              {existingClasses.map((c) => (
                <button key={c} onClick={() => { onSwitchClass(c); setSwitching(false); }} className={`w-full text-left px-3 py-1.5 rounded-lg text-sm ${c === user.classCode ? "bg-blue-50 brand-text font-semibold" : "text-gray-600 hover:bg-gray-50"}`}>{c}</button>
              ))}
              <div className="flex gap-1 pt-1">
                <input value={newClass} onChange={(e) => setNewClass(e.target.value)} placeholder="Mã lớp mới" className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none" />
                <button onClick={() => { if (newClass.trim()) { onSwitchClass(newClass.trim()); setNewClass(""); setSwitching(false); } }} className="accent-bg text-white text-xs px-2.5 rounded-lg">Vào</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 px-3 space-y-1">
        {items.map((it) => {
          const Icon = it.icon, active = view === it.id;
          return (
            <button key={it.id} onClick={() => setView(it.id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition ${active ? "bg-blue-50 brand-text" : "text-gray-500 hover:bg-gray-50"}`}>
              <Icon size={18} /> {it.label}
            </button>
          );
        })}
      </div>
      <div className="px-3 pb-5 pt-3 border-t border-gray-100">
        <div className="flex items-center gap-2.5 px-2 mb-3">
          <Avatar name={user.name} size={32} />
          <div className="min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{user.name}</p></div>
        </div>
        <button onClick={onLogout} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-gray-500 hover:bg-gray-50"><LogOut size={16} /> Đăng xuất</button>
      </div>
    </div>
  );
}

// ---------- App root ----------
export default function App() {
  const [user, setUser] = useState(null);
  const [roster, setRoster] = useState([]);
  const [entries, setEntries] = useState([]);
  const [defaultPassword, setDefaultPassword] = useState("cbm@2026");
  const [view, setView] = useState("home");
  const [showAdd, setShowAdd] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState("");

  const loadData = useCallback(async () => {
    try {
      const r = await storage.get("roster").catch(() => null);
      const e = await storage.get("entries").catch(() => null);
      const s = await storage.get("settings").catch(() => null);
      setRoster(r ? JSON.parse(r.value) : []);
      setEntries(e ? JSON.parse(e.value) : []);
      if (s) { const parsed = JSON.parse(s.value); if (parsed.defaultPassword) setDefaultPassword(parsed.defaultPassword); }
    } catch (err) {
      setSaveError("Không thể tải dữ liệu. Vui lòng tải lại trang.");
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => { loadData(); }, [loadData]);

  const persistRoster = async (next) => { setRoster(next); try { await storage.set("roster", JSON.stringify(next)); } catch (e) { setSaveError("Lỗi lưu danh sách."); } };
  const persistEntries = async (next) => { setEntries(next); try { await storage.set("entries", JSON.stringify(next)); } catch (e) { setSaveError("Lỗi lưu dữ liệu."); } };
  const persistSettings = async (pwd) => { setDefaultPassword(pwd); try { await storage.set("settings", JSON.stringify({ defaultPassword: pwd })); } catch (e) { /* noop */ } };

  const handleLogin = (acc) => { setUser({ ...acc, isAdmin: false }); setView("home"); };
  const handleAdminLogin = (classCode) => { setUser({ id: "admin", name: "Ban tổ chức", isAdmin: true, classCode }); setView("admin"); };
  const switchAdminClass = (classCode) => setUser((u) => ({ ...u, classCode }));

  const handleSaveEntry = ({ group, item, content }) => {
    const entry = { id: uid(), userId: user.id, userName: user.name, dept: user.dept, classCode: user.classCode, group, item, content, timestamp: Date.now(), likes: [] };
    persistEntries([...entries, entry]);
    setShowAdd(false);
  };
  const handleLike = (entryId) => {
    persistEntries(entries.map((e) => {
      if (e.id !== entryId) return e;
      const has = (e.likes || []).includes(user.id);
      return { ...e, likes: has ? e.likes.filter((id) => id !== user.id) : [...(e.likes || []), user.id] };
    }));
  };

  // Admin: account management actions (luôn gắn vào Mã lớp admin đang quản lý)
  const addAccount = ({ name, email, dept }) => persistRoster([...roster, { id: uid(), name, email, dept, classCode: user.classCode, password: defaultPassword, locked: false }]);
  const bulkImport = (parsed) => {
    const existing = new Set(roster.map((u) => normEmail(u.email)));
    const toAdd = parsed.filter((p) => !existing.has(normEmail(p.email))).map((p) => ({ id: uid(), name: p.name, email: p.email, dept: p.dept, classCode: user.classCode, password: defaultPassword, locked: false }));
    persistRoster([...roster, ...toAdd]);
    return toAdd.length;
  };
  const toggleLock = (id) => persistRoster(roster.map((u) => (u.id === id ? { ...u, locked: !u.locked } : u)));
  const resetPassword = (id) => persistRoster(roster.map((u) => (u.id === id ? { ...u, password: defaultPassword } : u)));
  const deleteAccount = (id) => persistRoster(roster.filter((u) => u.id !== id));

  // Chỉ lấy dữ liệu của đúng lớp đang đăng nhập / đang quản lý — tránh lẫn giữa các lớp
  const scopedRoster = useMemo(() => (user ? roster.filter((u) => u.classCode === user.classCode) : []), [roster, user]);
  const scopedEntries = useMemo(() => (user ? entries.filter((e) => e.classCode === user.classCode) : []), [entries, user]);
  const existingClasses = useMemo(() => [...new Set(roster.map((u) => u.classCode).filter(Boolean))], [roster]);


  if (!loaded) {
    return (
      <>
        <BrandStyles />
        <div className="min-h-screen flex items-center justify-center bg-white"><div className="animate-pulse brand-text font-medium text-sm">Đang tải...</div></div>
      </>
    );
  }
  if (!user) {
    return (
      <>
        <BrandStyles />
        <LoginScreen roster={roster} onLogin={handleLogin} onAdminLogin={handleAdminLogin} />
      </>
    );
  }

  const navItems = user.isAdmin ? ADMIN_NAV : STUDENT_NAV;

  return (
    <div className="min-h-screen app-bg flex" style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>
      <BrandStyles />
      <Sidebar view={view} setView={setView} items={navItems} user={user} onLogout={() => setUser(null)} existingClasses={existingClasses} onSwitchClass={switchAdminClass} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-end px-5 pt-3 md:hidden">
          <button onClick={() => setUser(null)} className="flex items-center gap-1 text-xs text-gray-400"><LogOut size={13} /> Đăng xuất</button>
        </div>
        {saveError && <div className="mx-5 md:mx-8 mt-3 md:mt-6 bg-red-50 accent-text text-xs px-3 py-2 rounded-lg">{saveError}</div>}

        {user.isAdmin ? (
          <>
            {view === "admin" && <AdminScreen entries={scopedEntries} roster={scopedRoster} classCode={user.classCode} />}
            {view === "accounts" && (
              <AdminAccountsScreen
                roster={scopedRoster} defaultPassword={defaultPassword} classCode={user.classCode}
                onAdd={addAccount} onBulkImport={bulkImport} onToggleLock={toggleLock}
                onResetPassword={resetPassword} onDelete={deleteAccount} onDefaultPasswordChange={persistSettings}
              />
            )}
          </>
        ) : (
          <>
            {view === "home" && <HomeScreen user={user} entries={scopedEntries} roster={scopedRoster} onOpenAdd={() => setShowAdd(true)} onLike={handleLike} />}
            {view === "history" && <HistoryScreen user={user} entries={scopedEntries} />}
            {view === "leaderboard" && <LeaderboardScreen entries={scopedEntries} roster={scopedRoster} currentUserId={user.id} />}
          </>
        )}
      </div>

      {showAdd && <AddEntryScreen onSave={handleSaveEntry} onClose={() => setShowAdd(false)} />}
      <BottomNav view={view} setView={setView} items={navItems} />
    </div>
  );
}
