import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import {
  Flame, Trophy, Plus, Clock, BarChart3, LogOut, Heart, Download, X, ChevronRight,
  Sunrise, AlertCircle, Check, User, Lock, Upload, UserPlus, KeyRound, Ban, Trash2,
  Menu, LayoutDashboard, Users2, Home as HomeIcon, List, Building2,
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
const COMPLETION_THRESHOLD = 8; // Số ngày tối thiểu để tính là "hoàn thành toàn khóa"
const CLASS_INDEX_KEY = "classIndex";
const rosterKey = (c) => `roster_${c}`;
const entriesKey = (c) => `entries_${c}`;
const settingsKey = (c) => `settings_${c}`;
const storageGet = (key) => storage.get(key);
const storageSet = (key, value) => storage.set(key, value);
// storageUpdate: dùng Firestore Transaction THẬT — Firebase tự đảm bảo không ai ghi đè mất
// dữ liệu của người khác, dù nhiều người thao tác cùng lúc.
const storageUpdate = (key, mutatorFn) => storage.update(key, mutatorFn);
// Màu thương hiệu VietinBank chính thức
const BLUE = "#005993";       // Vietin Dark Blue
const RED = "#D71249";        // Vietin Red
const LIGHT_BLUE = "#7ED3F7"; // Vietin Light Blue

const BrandStyles = () => (
  <style>{`
    .brand-bg { background-color: ${BLUE}; }
    .accent-bg { background-color: ${RED}; }
    .section-marker { display: inline-block; width: 4px; height: 16px; border-radius: 2px; background-color: ${RED}; flex-shrink: 0; }
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
const dayKeyToDate = (dk) => { const [y, m, d] = dk.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (date, n) => { const d = new Date(date); d.setDate(d.getDate() + n); return d; };

// Tính các khoảng thời gian (>=2 ngày liên tiếp) mà 1 cá nhân KHÔNG ứng dụng, dựa trên danh sách ngày đã ứng dụng (sorted, dayKey)
function computeMissedGaps(sortedDays) {
  const gaps = [];
  for (let i = 0; i < sortedDays.length - 1; i++) {
    const gap = daysBetween(sortedDays[i], sortedDays[i + 1]);
    const missed = gap - 1;
    if (missed >= 2) {
      const start = addDays(dayKeyToDate(sortedDays[i]), 1);
      const end = addDays(dayKeyToDate(sortedDays[i + 1]), -1);
      gaps.push({ start: start.getTime(), end: end.getTime(), missed, ongoing: false });
    }
  }
  if (sortedDays.length > 0) {
    const lastDay = sortedDays[sortedDays.length - 1];
    const missed = daysBetween(lastDay, todayKey()) - 1;
    if (missed >= 2) {
      const start = addDays(dayKeyToDate(lastDay), 1);
      const end = addDays(new Date(), -1);
      gaps.push({ start: start.getTime(), end: end.getTime(), missed, ongoing: true });
    }
  }
  return gaps.sort((a, b) => b.start - a.start);
}
const uid = () => Math.random().toString(36).slice(2, 10);
const normUsername = (s) => (s || "").trim().toLowerCase();

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
  // Điểm mỗi lượt ứng dụng: bài đầu tiên trong ngày +1, các bài tiếp theo trong cùng ngày chỉ +0.5
  const byDay = {};
  userEntries.forEach((e) => { const d = dayKey(e.timestamp); byDay[d] = byDay[d] || []; byDay[d].push(e); });
  Object.values(byDay).forEach((list) => { points += 1 + (list.length - 1) * 0.5; });
  userEntries.forEach((e) => {
    const d = dayKey(e.timestamp);
    if ((earlyBirdDayMap[d] || []).includes(e.id)) points += 1;
  });
  const lastDay = days[days.length - 1];
  const activeStreak = daysBetween(lastDay, todayKey()) <= 1 ? curStreak : 0;
  return { points, streak: activeStreak, longestStreak, daysLogged: days.length };
}

// Tính điểm của TỪNG bài (dùng cho Excel) — tổng các bài của 1 người cộng lại
// luôn khớp đúng với computeUserStats(...).points ở trên, vì dùng chung 1 công thức.
function computeEntryPoints(userEntries, earlyBirdDayMap) {
  const result = {};
  if (userEntries.length === 0) return result;
  const byDay = {};
  userEntries.forEach((e) => { const d = dayKey(e.timestamp); byDay[d] = byDay[d] || []; byDay[d].push(e); });
  const days = Object.keys(byDay).sort();
  let curStreak = 0, prevDay = null;
  days.forEach((d) => {
    const list = byDay[d].sort((a, b) => a.timestamp - b.timestamp);
    let gapPenalty = 0;
    if (prevDay === null) curStreak = 1;
    else {
      const gap = daysBetween(prevDay, d);
      if (gap === 1) curStreak += 1;
      else { if (gap - 1 >= 2) gapPenalty = -1; curStreak = 1; }
    }
    const streakBonus = curStreak % 3 === 0 ? 3 : 0;
    list.forEach((e, idx) => {
      let pts = idx === 0 ? 1 : 0.5;
      if (idx === 0) {
        pts += streakBonus + gapPenalty;
        if ((earlyBirdDayMap[d] || []).includes(e.id)) pts += 1;
      }
      result[e.id] = pts;
    });
    prevDay = d;
  });
  return result;
}

// Lọc bỏ các bài nhập TRƯỚC "Ngày bắt đầu lớp" khỏi mọi tính toán điểm/dashboard —
// dữ liệu gốc không hề bị xóa, chỉ ẩn khỏi tính toán khi startDate còn hiệu lực.
function filterByStartDate(entriesList, startDate) {
  if (!startDate) return entriesList;
  return entriesList.filter((e) => dayKey(e.timestamp) >= startDate);
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
const EntryDetail = ({ e, size = "sm" }) => {
  const textCls = size === "sm" ? "text-sm text-gray-700 leading-relaxed" : "text-sm text-gray-600 leading-relaxed";
  return (
    <div className="space-y-2">
      <div><p className="text-[11px] font-semibold text-gray-400 uppercase mb-0.5">Bối cảnh</p><p className={textCls}>{e.context}</p></div>
      <div><p className="text-[11px] font-semibold text-gray-400 uppercase mb-0.5">Hành vi thực hiện</p><p className={textCls}>{e.action}</p></div>
      <div><p className="text-[11px] font-semibold text-gray-400 uppercase mb-0.5">Kết quả đạt được</p><p className={textCls}>{e.result}</p></div>
    </div>
  );
};
const Field = ({ icon: Icon, ...props }) => (
  <div className="relative">
    {Icon && <Icon size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />}
    <input {...props} className={`w-full border border-gray-200 rounded-xl py-3 text-[15px] outline-none brand-focus ${Icon ? "pl-10 pr-3.5" : "px-3.5"}`} />
  </div>
);

// ---------- Login ----------
function LoginScreen({ classIndex, onLoginAttempt, onAdminLogin }) {
  const [mode, setMode] = useState("student");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [classCode, setClassCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submitStudent = async () => {
    if (!username.trim() || !password) { setError("Vui lòng nhập đầy đủ User AD và mật khẩu."); return; }
    setSubmitting(true);
    setError("");
    const res = await onLoginAttempt(username, password);
    setSubmitting(false);
    if (res && res.error) setError(res.error);
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
          <p className="text-blue-100 text-sm mt-1.5">Lớp Cán bộ mới Trụ sở chính VTB</p>
        </div>

        <Card className="p-5">
          <div className="flex gap-2 mb-5 bg-gray-100 rounded-xl p-1">
            <button onClick={() => { setMode("student"); setError(""); }} className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${mode === "student" ? "bg-white shadow brand-text" : "text-gray-500"}`}>Học viên</button>
            <button onClick={() => { setMode("admin"); setError(""); }} className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${mode === "admin" ? "bg-white shadow brand-text" : "text-gray-500"}`}>Ban tổ chức</button>
          </div>

          {mode === "student" ? (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">User AD</label>
                <Field icon={User} type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="vd: tranghh" autoCapitalize="none" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Mật khẩu</label>
                <Field icon={Lock} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mật khẩu được cấp" onKeyDown={(e) => e.key === "Enter" && submitStudent()} />
              </div>
              {error && <p className="accent-text text-xs">{error}</p>}
              <button onClick={submitStudent} disabled={submitting} className="w-full accent-bg text-white font-semibold py-3.5 rounded-xl active:scale-[0.98] transition mt-1 disabled:opacity-60">{submitting ? "Đang đăng nhập..." : "Đăng nhập"}</button>
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
                {classIndex.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {classIndex.map((c) => (
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
  const [context, setContext] = useState("");
  const [action, setAction] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
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

        <label className="text-xs font-medium text-gray-500 mb-1 block">Bối cảnh</label>
        <textarea value={context} onChange={(e) => setContext(e.target.value)}
          rows={2} className="w-full border border-gray-200 rounded-xl px-3.5 py-3 text-[15px] mb-3 outline-none brand-focus-border resize-none" />

        <label className="text-xs font-medium text-gray-500 mb-1 block">Hành vi thực hiện</label>
        <textarea value={action} onChange={(e) => setAction(e.target.value)}
          rows={2} className="w-full border border-gray-200 rounded-xl px-3.5 py-3 text-[15px] mb-3 outline-none brand-focus-border resize-none" />

        <label className="text-xs font-medium text-gray-500 mb-1 block">Kết quả đạt được</label>
        <textarea value={result} onChange={(e) => setResult(e.target.value)}
          rows={2} className="w-full border border-gray-200 rounded-xl px-3.5 py-3 text-[15px] outline-none brand-focus-border resize-none" />

        {error && <p className="accent-text text-xs mt-2">{error}</p>}
        <button
          disabled={saving}
          onClick={async () => {
            if (saving) return;
            if (!context.trim() || !action.trim() || !result.trim()) { setError("Vui lòng nhập đầy đủ cả 3 mục: Bối cảnh, Hành vi thực hiện, Kết quả đạt được."); return; }
            setSaving(true);
            await onSave({ group, item, context: context.trim(), action: action.trim(), result: result.trim() });
          }}
          className="w-full brand-bg text-white font-semibold py-3.5 rounded-xl mt-4 active:scale-[0.98] transition disabled:opacity-60">{saving ? "Đang lưu..." : "Lưu"}</button>
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
  // Các khoảng ngày CÁ NHÂN (≥2 ngày liên tiếp) mà chính học viên này chưa ứng dụng
  const myDays = useMemo(() => [...new Set(myEntries.map((e) => dayKey(e.timestamp)))].sort(), [myEntries]);
  const myMissedGaps = useMemo(() => computeMissedGaps(myDays), [myDays]);

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
          <div className="text-center px-1"><p className="text-lg font-bold accent-text">{myStats.points}</p><p className="text-[11px] text-gray-500 mt-0.5">Điểm</p></div>
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
            <h3 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2">🆕 10 ứng dụng mới nhất</h3>
            <div className="space-y-2.5 md:grid md:grid-cols-2 md:gap-3 md:space-y-0">
              {latest10.length === 0 && <p className="text-sm text-gray-400 py-2">Chưa có bài ứng dụng nào.</p>}
              {latest10.map((e) => (
                <Card key={e.id} className="p-3.5">
                  <div className="flex items-center gap-2.5 mb-2">
                    <Avatar name={e.userName} size={30} />
                    <div className="flex-1 min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{e.userName}</p><p className="text-[11px] text-gray-400">{e.dept} · {fmtDate(e.timestamp)} {fmtTime(e.timestamp)}</p></div>
                    <Pill tone="blue">{e.item.replace(/^Thói quen \d: /, "")}</Pill>
                  </div>
                  <EntryDetail e={e} />
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
                  <span className="text-sm font-bold accent-text">{u.points}đ</span>
                </div>
              ))}
            </div>
          </Card>

          <div className="flex items-center gap-2 mb-3"><AlertCircle size={16} className="accent-text" /><h3 className="font-semibold text-gray-900 text-sm">Ngày bạn đã bỏ lỡ (≥2 ngày liên tiếp)</h3></div>
          <Card className="p-3">
            <div className="space-y-2.5">
              {myMissedGaps.length === 0 && <p className="text-sm text-gray-400 py-2 text-center">Bạn chưa bỏ lỡ khoảng nào từ 2 ngày liên tiếp trở lên 🎉</p>}
              {myMissedGaps.map((g, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-red-50 flex items-center justify-center shrink-0"><AlertCircle size={16} className="accent-text" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{fmtDate(g.start)} – {fmtDate(g.end)}</p>
                    <p className="text-[11px] text-gray-400">{g.ongoing ? "Đang tiếp diễn" : "Đã kết thúc"}</p>
                  </div>
                  <span className="text-xs accent-text font-semibold whitespace-nowrap">Bỏ {g.missed} ngày</span>
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
      <h1 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">Lịch sử ứng dụng của tôi</h1>
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
                <EntryDetail e={e} />
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
      <h1 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">⚡ Bảng xếp hạng toàn lớp</h1>
      <div className="space-y-2">
        {allStats.map((u, i) => (
          <Card key={u.id} className={`p-3.5 flex items-center gap-3 ${u.id === currentUserId ? "brand-ring-2" : ""}`}>
            <span className={`text-sm w-7 font-bold ${i < 3 ? "text-amber-500" : "text-gray-400"}`}>{i + 1}</span>
            <Avatar name={u.name} size={34} />
            <div className="flex-1 min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{u.name}{u.id === currentUserId && " (bạn)"}</p><p className="text-[11px] text-gray-400 truncate">{u.dept} · {u.daysLogged} ngày · 🔥{u.streak}</p></div>
            <span className="text-sm font-bold accent-text">{u.points}đ</span>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------- Admin: Accounts management ----------
function AdminAccountsScreen({ roster, defaultPassword, classStartDate, classCode, onAdd, onBulkImport, onToggleLock, onResetPassword, onDelete, onDefaultPasswordChange, onClassStartDateChange, onDeleteClass }) {
  const [name, setName] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [username, setUsername] = useState("");
  const [dept, setDept] = useState("");
  const [error, setError] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const fileRef = useRef(null);

  const addManual = () => {
    if (!name.trim() || !username.trim()) { setError("Vui lòng nhập họ tên và User AD."); return; }
    if (roster.some((u) => normUsername(u.username) === normUsername(username))) { setError("User AD này đã tồn tại."); return; }
    onAdd({ name: name.trim(), username: normUsername(username), dept: dept.trim() });
    setName(""); setUsername(""); setDept(""); setError("");
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
        username: pick(row, ["user ad", "user", "username", "tên đăng nhập"]),
        dept: pick(row, ["đơn vị", "don vi", "dept", "phòng", "chi nhánh"]),
      })).filter((r) => r.username && r.name);
      if (parsed.length === 0) { setImportMsg("Không tìm thấy dữ liệu hợp lệ. Cần cột: Họ tên, User AD, Đơn vị."); return; }
      const added = await onBulkImport(parsed);
      setImportMsg(`Đã nhập ${added} tài khoản mới (bỏ qua User AD trùng).`);
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <Card className="p-4">
          <p className="text-sm font-medium text-gray-700 mb-2">Mật khẩu mặc định cấp cho tài khoản mới</p>
          <div className="flex gap-2">
            <Field value={defaultPassword} onChange={(e) => onDefaultPasswordChange(e.target.value)} placeholder="VD: cbm@2026" />
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5">Áp dụng cho tài khoản thêm mới thủ công hoặc nhập từ Excel.</p>
        </Card>

        <Card className="p-4">
          <p className="text-sm font-medium text-gray-700 mb-2">Ngày bắt đầu lớp</p>
          <div className="flex gap-2">
            <Field type="date" value={classStartDate} onChange={(e) => onClassStartDateChange(e.target.value)} />
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5">Học viên chưa từng ứng dụng lần nào sẽ được tính số ngày bỏ lỡ kể từ ngày này. Để trống nếu chưa muốn áp dụng.</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <Card className="p-4">
          <p className="text-sm font-semibold text-gray-800 mb-1 flex items-center gap-1.5"><UserPlus size={15} /> Thêm 1 tài khoản</p>
          <p className="text-[11px] text-gray-400 mb-3">Sẽ được thêm vào <strong>Lớp {classCode}</strong></p>
          <div className="space-y-2.5">
            <Field placeholder="Họ và tên" value={name} onChange={(e) => setName(e.target.value)} />
            <Field placeholder="User AD (vd: tranghh)" type="text" value={username} onChange={(e) => setUsername(e.target.value)} />
            <Field placeholder="Đơn vị / Phòng" value={dept} onChange={(e) => setDept(e.target.value)} />
            {error && <p className="accent-text text-xs">{error}</p>}
            <button onClick={addManual} className="w-full brand-bg text-white font-semibold py-2.5 rounded-xl text-sm">Thêm tài khoản</button>
          </div>
        </Card>

        <Card className="p-4">
          <p className="text-sm font-semibold text-gray-800 mb-1 flex items-center gap-1.5"><Upload size={15} /> Nhập hàng loạt từ Excel</p>
          <p className="text-[11px] text-gray-400 mb-2">Sẽ được thêm vào <strong>Lớp {classCode}</strong></p>
          <p className="text-xs text-gray-500 mb-3">File cần có các cột: <strong>Họ tên, User AD, Đơn vị</strong>.</p>
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
              <p className="text-[11px] text-gray-400 truncate">{u.username} · {u.dept}</p>
            </div>
            <Pill tone="gray">Lớp {u.classCode}</Pill>
            <button onClick={() => onResetPassword(u.id)} title="Cấp lại mật khẩu mặc định" className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-gray-500 brand-hover-text"><KeyRound size={15} /></button>
            <button onClick={() => onToggleLock(u.id)} title={u.locked ? "Mở khóa" : "Khóa tài khoản"} className={`w-8 h-8 rounded-lg flex items-center justify-center ${u.locked ? "bg-red-50 accent-text" : "bg-gray-50 text-gray-500 accent-hover-text"}`}><Ban size={15} /></button>
            <button onClick={() => onDelete(u.id)} title="Xóa tài khoản" className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-gray-500 accent-hover-text"><Trash2 size={15} /></button>
          </Card>
        ))}
      </div>

      <div className="mt-8 pt-5 border-t border-gray-100">
        <p className="text-sm font-semibold accent-text mb-1">⚠️ Vùng nguy hiểm</p>
        <p className="text-xs text-gray-500 mb-3">Xoá toàn bộ tài khoản và lượt ứng dụng của lớp <strong>{classCode}</strong>. Hành động này không thể hoàn tác — nên xuất Excel sao lưu trước khi xoá.</p>
        <div className="flex flex-col sm:flex-row gap-2 max-w-lg">
          <Field value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={`Gõ "${classCode}" để xác nhận`} />
          <button
            onClick={() => { if (confirmText.trim() === classCode) { onDeleteClass(); setConfirmText(""); } }}
            disabled={confirmText.trim() !== classCode}
            className="accent-bg text-white font-semibold px-4 py-3 rounded-xl text-sm whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Xoá dữ liệu lớp {classCode}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Admin: Dashboard ----------
function AdminScreen({ entries, scoredEntries, roster, classCode, classStartDate, onDeleteEntry }) {
  const [selected, setSelected] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  // earlyMap/điểm/streak/ngày làm đều tính trên scoredEntries (đã lọc theo Ngày bắt đầu lớp)
  const earlyMap = useMemo(() => earlyBirdMapForDay(scoredEntries), [scoredEntries]);
  const allStats = useMemo(() => {
    const scoredByUser = {};
    scoredEntries.forEach((e) => { scoredByUser[e.userId] = scoredByUser[e.userId] || []; scoredByUser[e.userId].push(e); });
    const fullByUser = {};
    entries.forEach((e) => { fullByUser[e.userId] = fullByUser[e.userId] || []; fullByUser[e.userId].push(e); });
    return roster.map((u) => {
      const scoredList = (scoredByUser[u.id] || []).sort((a, b) => a.timestamp - b.timestamp);
      const fullList = (fullByUser[u.id] || []).sort((a, b) => a.timestamp - b.timestamp);
      const stats = computeUserStats(scoredList, earlyMap);
      const lastDay = scoredList.length ? dayKey(scoredList[scoredList.length - 1].timestamp) : null;
      let missedDays = lastDay ? daysBetween(lastDay, todayKey()) : null;
      // Chưa từng ứng dụng lần nào (tính từ ngày bắt đầu): nếu đã đặt "Ngày bắt đầu lớp", tính số ngày bỏ lỡ kể từ đó
      if (missedDays === null && classStartDate) {
        const sinceStart = daysBetween(classStartDate, todayKey());
        if (sinceStart >= 0) missedDays = sinceStart;
      }
      return { ...u, ...stats, list: fullList, missedDays };
    }).sort((a, b) => b.points - a.points);
  }, [entries, scoredEntries, roster, earlyMap, classStartDate]);

  const doneToday = allStats.filter((u) => u.list.some((e) => dayKey(e.timestamp) === todayKey()));
  const notDoneToday = allStats.filter((u) => !u.list.some((e) => dayKey(e.timestamp) === todayKey()));
  const completionRate = roster.length ? Math.round((doneToday.length / roster.length) * 100) : 0;
  const missing2Days = allStats
    .filter((u) => u.missedDays !== null && u.missedDays >= 2)
    .sort((a, b) => b.missedDays - a.missedDays);
  const courseCompletedCount = allStats.filter((u) => u.daysLogged >= COMPLETION_THRESHOLD).length;
  const courseCompletionRate = roster.length ? Math.round((courseCompletedCount / roster.length) * 100) : 0;
  const todaysEarlyBird = useMemo(() => (earlyMap[todayKey()] || []).map((id) => scoredEntries.find((e) => e.id === id)).filter(Boolean), [earlyMap, scoredEntries]);
  const notCompletedCourse = allStats
    .filter((u) => u.daysLogged < COMPLETION_THRESHOLD)
    .sort((a, b) => a.daysLogged - b.daysLogged);

  const exportExcel = () => {
    // Tính điểm riêng cho từng bài (theo từng người) — tổng các dòng của 1 người = đúng "Điểm (tổng)"
    const entryPointsByUser = {};
    allStats.forEach((u) => {
      const scoredOnly = u.list.filter((e) => !classStartDate || dayKey(e.timestamp) >= classStartDate);
      entryPointsByUser[u.id] = computeEntryPoints(scoredOnly, earlyMap);
    });
    const rows = entries.slice().sort((a, b) => a.timestamp - b.timestamp).map((e) => {
      const u = allStats.find((x) => x.id === e.userId);
      const isCounted = !classStartDate || dayKey(e.timestamp) >= classStartDate;
      const entryPoints = u && isCounted ? (entryPointsByUser[u.id][e.id] ?? 0) : 0;
      return {
        "Ngày thực hiện": fmtDate(e.timestamp),
        "Tên": e.userName, "User AD": u ? u.username : "", "Đơn vị": e.dept,
        "Điểm": entryPoints, "Điểm (tổng)": u ? u.points : "", "Số ngày ứng dụng": u ? u.daysLogged : "",
        "Tính vào điểm": isCounted ? "Có" : "Không (trước ngày bắt đầu lớp)",
        "Early Bird": (earlyMap[dayKey(e.timestamp)] || []).includes(e.id) ? "Có" : "",
        "Thời gian nhập": new Date(e.timestamp).toLocaleString("vi-VN"),
        "Danh mục": e.group,
        "Bối cảnh": e.context, "Hành vi thực hiện": e.action, "Kết quả đạt được": e.result,
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 12 }, { wch: 20 }, { wch: 22 }, { wch: 20 }, { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 22 }, { wch: 10 }, { wch: 18 }, { wch: 26 }, { wch: 40 }, { wch: 40 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ứng dụng sau đào tạo");
    XLSX.writeFile(wb, `bao-cao-ung-dung-${todayKey()}.xlsx`);
  };

  const exportSummaryExcel = () => {
    const wb = XLSX.utils.book_new();
    const addSheet = (name, rows, colWidths) => {
      const ws = XLSX.utils.json_to_sheet(rows);
      ws["!cols"] = colWidths;
      XLSX.utils.book_append_sheet(wb, ws, name);
    };

    addSheet("Chưa nhập hôm nay", notDoneToday.map((u) => ({
      "Tên": u.name, "User AD": u.username, "Đơn vị": u.dept,
      "Trạng thái": u.missedDays !== null ? `Bỏ ${u.missedDays} ngày` : "Chưa bắt đầu",
    })), [{ wch: 22 }, { wch: 24 }, { wch: 20 }, { wch: 16 }]);

    addSheet("Chưa nhập từ 2 ngày", missing2Days.map((u) => ({
      "Tên": u.name, "User AD": u.username, "Đơn vị": u.dept, "Số ngày bỏ lỡ": u.missedDays,
    })), [{ wch: 22 }, { wch: 24 }, { wch: 20 }, { wch: 14 }]);

    addSheet("Chưa hoàn thành toàn khóa", notCompletedCourse.map((u) => ({
      "Tên": u.name, "User AD": u.username, "Đơn vị": u.dept,
      "Số ngày đã làm": `${u.daysLogged}/${PROGRAM_DAYS}`,
    })), [{ wch: 22 }, { wch: 24 }, { wch: 20 }, { wch: 16 }]);

    addSheet("Theo dõi cá nhân - Toàn lớp", allStats.map((u, i) => ({
      "STT": i + 1, "Tên": u.name, "User AD": u.username, "Đơn vị": u.dept,
      "Điểm": u.points, "Số ngày đã làm": u.daysLogged, "Streak hiện tại": u.streak,
    })), [{ wch: 6 }, { wch: 22 }, { wch: 24 }, { wch: 20 }, { wch: 10 }, { wch: 14 }, { wch: 14 }]);

    XLSX.writeFile(wb, `danh-sach-theo-doi-${todayKey()}.xlsx`);
  };


  if (selected) {
    const u = allStats.find((x) => x.id === selected);
    return (
      <div className="max-w-3xl mx-auto px-5 md:px-8 pt-6 pb-24 md:pb-8">
        <button onClick={() => { setSelected(null); setConfirmDeleteId(null); }} className="text-sm brand-text font-medium mb-4">← Quay lại</button>
        <div className="flex items-center gap-3 mb-4">
          <Avatar name={u.name} size={48} />
          <div><h1 className="font-bold text-gray-900">{u.name}</h1><p className="text-xs text-gray-400">{u.username} · {u.dept}</p></div>
        </div>
        <Card className="p-4 grid grid-cols-3 divide-x divide-gray-100 mb-5">
          <div className="text-center"><p className="text-lg font-bold accent-text">{u.points}</p><p className="text-[11px] text-gray-500">Điểm</p></div>
          <div className="text-center"><p className="text-lg font-bold">{u.daysLogged}</p><p className="text-[11px] text-gray-500">Ngày làm</p></div>
          <div className="text-center"><p className="text-lg font-bold">{u.streak}🔥</p><p className="text-[11px] text-gray-500">Streak</p></div>
        </Card>
        <h3 className="font-semibold text-sm text-gray-900 mb-2">Lịch sử &amp; minh chứng</h3>
        <div className="space-y-2.5">
          {u.list.slice().reverse().map((e) => (
            <Card key={e.id} className="p-3.5">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-xs text-gray-400">{fmtDate(e.timestamp)} {fmtTime(e.timestamp)} · {e.item}</p>
                {confirmDeleteId === e.id ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[11px] accent-text font-medium">Xóa?</span>
                    <button onClick={() => { onDeleteEntry(e.id); setConfirmDeleteId(null); }} className="text-[11px] font-semibold accent-bg text-white px-2 py-1 rounded-md">Có</button>
                    <button onClick={() => setConfirmDeleteId(null)} className="text-[11px] font-semibold bg-gray-100 text-gray-600 px-2 py-1 rounded-md">Không</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(e.id)}
                    title="Xóa bài ứng dụng này"
                    className="w-7 h-7 shrink-0 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400 accent-hover-text"
                  ><Trash2 size={14} /></button>
                )}
              </div>
              <EntryDetail e={e} />
            </Card>
          ))}
          {u.list.length === 0 && <p className="text-sm text-gray-400">Chưa có dữ liệu.</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-5 md:px-8 pt-6 pb-24 md:pb-8">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Dashboard Ban tổ chức</h1>
          <Pill tone="blue">Lớp {classCode}</Pill>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={exportSummaryExcel} className="flex items-center gap-1.5 bg-gray-100 text-gray-700 text-xs font-semibold px-3 py-2 rounded-lg"><Download size={14} /> Xuất danh sách theo dõi</button>
          <button onClick={exportExcel} className="flex items-center gap-1.5 brand-bg text-white text-xs font-semibold px-3 py-2 rounded-lg"><Download size={14} /> Xuất chi tiết ứng dụng</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <Card className="p-4"><p className="text-2xl font-bold text-gray-900">{roster.length}</p><p className="text-xs text-gray-500 mt-1">Tổng học viên</p></Card>
        <Card className="p-4"><p className="text-2xl font-bold text-emerald-600">{doneToday.length}</p><p className="text-xs text-gray-500 mt-1">Đã nhập hôm nay</p></Card>
        <Card className="p-4"><p className="text-2xl font-bold accent-text">{notDoneToday.length}</p><p className="text-xs text-gray-500 mt-1">Chưa nhập hôm nay</p></Card>
        <Card className="p-4"><p className="text-2xl font-bold brand-text">{completionRate}%</p><p className="text-xs text-gray-500 mt-1">Tỷ lệ hoàn thành hôm nay</p></Card>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
        <Card className="p-4"><p className="text-2xl font-bold accent-text">{missing2Days.length}</p><p className="text-xs text-gray-500 mt-1">Học viên chưa nhập từ 2 ngày trở lên</p></Card>
        <Card className="p-4"><p className="text-2xl font-bold brand-text">{courseCompletionRate}%</p><p className="text-xs text-gray-500 mt-1">Tỷ lệ hoàn thành toàn khóa ({courseCompletedCount}/{roster.length} người đạt ≥ {COMPLETION_THRESHOLD}/{PROGRAM_DAYS} ngày)</p></Card>
      </div>

      <div className="mb-5">
        <h3 className="font-semibold text-sm text-gray-900 mb-2 flex items-center gap-1.5"><Sunrise size={15} className="text-amber-500" /> Top 5 Early Bird hôm nay</h3>
        <Card className="p-3 max-w-md">
          {todaysEarlyBird.length === 0 ? <p className="text-sm text-gray-400 py-1 text-center">Chưa có ai ứng dụng hôm nay.</p> : (
            <div className="space-y-2.5">
              {todaysEarlyBird.map((e, i) => (
                <div key={e.id} className="flex items-center gap-3">
                  <span className="text-lg w-6">{["🥇", "🥈", "🥉", "4️⃣", "5️⃣"][i]}</span>
                  <Avatar name={e.userName} size={30} />
                  <span className="flex-1 text-sm font-medium text-gray-800 truncate">{e.userName}</span>
                  <span className="text-xs text-gray-400 whitespace-nowrap">{fmtTime(e.timestamp)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
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
          <h3 className="font-semibold text-sm text-gray-900 mb-2 flex items-center gap-1.5"><AlertCircle size={15} className="accent-text" /> Chưa nhập ≥ 2 ngày</h3>
          <div className="space-y-2">
            {missing2Days.length === 0 && <p className="text-sm text-gray-400">Không có ai bỏ lỡ 2 ngày liên tiếp trở lên 🎉</p>}
            {missing2Days.map((u) => (
              <button key={u.id} onClick={() => setSelected(u.id)} className="w-full text-left">
                <Card className="p-3 flex items-center gap-3">
                  <Avatar name={u.name} size={30} />
                  <div className="flex-1 min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{u.name}</p><p className="text-[11px] text-gray-400 truncate">{u.dept}</p></div>
                  <span className="text-xs accent-text font-semibold whitespace-nowrap">Bỏ {u.missedDays} ngày</span>
                  <ChevronRight size={16} className="text-gray-300" />
                </Card>
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-sm text-gray-900 mb-2 flex items-center gap-1.5"><AlertCircle size={15} className="accent-text" /> Chưa hoàn thành toàn khóa</h3>
          <p className="text-[11px] text-gray-400 mb-2 -mt-1">Dưới {COMPLETION_THRESHOLD}/{PROGRAM_DAYS} ngày</p>
          <div className="space-y-2">
            {notCompletedCourse.length === 0 && <p className="text-sm text-gray-400">Cả lớp đã hoàn thành toàn khóa 🎉</p>}
            {notCompletedCourse.map((u) => (
              <button key={u.id} onClick={() => setSelected(u.id)} className="w-full text-left">
                <Card className="p-3 flex items-center gap-3">
                  <Avatar name={u.name} size={30} />
                  <div className="flex-1 min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{u.name}</p><p className="text-[11px] text-gray-400 truncate">{u.dept}</p></div>
                  <span className="text-xs accent-text font-semibold whitespace-nowrap">{u.daysLogged}/{PROGRAM_DAYS} ngày</span>
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
                  <span className="text-sm font-bold accent-text">{u.points}đ</span>
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
// ---------- Admin: Danh sách các lớp ----------
function ClassesOverviewScreen({ classIndex, currentClass, onSwitchClass, onGoToDashboard }) {
  const [classes, setClasses] = useState(null); // null = đang tải

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results = [];
      for (const c of classIndex) {
        try {
          const r = await storageGet(rosterKey(c)).catch(() => null);
          const e = await storageGet(entriesKey(c)).catch(() => null);
          const rosterArr = r ? JSON.parse(r.value) : [];
          const entriesArr = e ? JSON.parse(e.value) : [];
          let lastActivity = null;
          entriesArr.forEach((en) => { if (!lastActivity || en.timestamp > lastActivity) lastActivity = en.timestamp; });
          results.push({ classCode: c, studentCount: rosterArr.length, entryCount: entriesArr.length, lastActivity });
        } catch (err) { /* bỏ qua lớp lỗi, không chặn cả danh sách */ }
      }
      results.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
      if (!cancelled) setClasses(results);
    })();
    return () => { cancelled = true; };
  }, [classIndex]);

  return (
    <div className="max-w-3xl mx-auto px-5 md:px-8 pt-6 pb-24 md:pb-8">
      <h1 className="text-lg font-bold text-gray-900 mb-1">Danh sách các lớp</h1>
      <p className="text-xs text-gray-500 mb-4">{classes === null ? "Đang tải..." : `Tổng cộng ${classes.length} lớp đang có dữ liệu trong hệ thống.`}</p>

      <div className="space-y-2.5">
        {classes === null && <p className="text-sm text-gray-400">Đang tải dữ liệu các lớp...</p>}
        {classes !== null && classes.length === 0 && <p className="text-sm text-gray-400">Chưa có lớp nào có dữ liệu.</p>}
        {(classes || []).map((c) => (
          <Card key={c.classCode} className={`p-4 ${c.classCode === currentClass ? "ring-2 brand-ring-2" : ""}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><Building2 size={18} className="brand-text" /></div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">Lớp {c.classCode}{c.classCode === currentClass && <span className="text-[11px] font-normal text-gray-400"> (đang quản lý)</span>}</p>
                  <p className="text-[11px] text-gray-400">{c.studentCount} học viên · {c.entryCount} lượt ứng dụng{c.lastActivity ? ` · gần nhất ${fmtDate(c.lastActivity)}` : ""}</p>
                </div>
              </div>
              {c.classCode === currentClass ? (
                <button onClick={onGoToDashboard} className="text-xs font-semibold brand-text px-3 py-2 rounded-lg bg-blue-50 whitespace-nowrap">Xem Dashboard</button>
              ) : (
                <button onClick={() => onSwitchClass(c.classCode)} className="text-xs font-semibold text-gray-600 px-3 py-2 rounded-lg bg-gray-50 hover:bg-gray-100 whitespace-nowrap">Chuyển sang</button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

const STUDENT_NAV = [
  { id: "home", label: "Trang chủ", icon: HomeIcon },
  { id: "history", label: "Lịch sử", icon: Clock },
  { id: "leaderboard", label: "Xếp hạng", icon: Trophy },
];
const ADMIN_NAV = [
  { id: "admin", label: "Dashboard", icon: LayoutDashboard },
  { id: "accounts", label: "Tài khoản", icon: Users2 },
  { id: "classes", label: "Danh sách lớp", icon: List },
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
  const [classIndex, setClassIndex] = useState([]); // danh sách mã lớp đã biết (tài liệu nhỏ, dùng chung)
  const [roster, setRoster] = useState([]); // roster của ĐÚNG lớp đang hoạt động (đã tách riêng theo lớp)
  const [entries, setEntries] = useState([]); // entries của ĐÚNG lớp đang hoạt động
  const [defaultPassword, setDefaultPassword] = useState("123456");
  const [classStartDate, setClassStartDate] = useState(""); // ngày bắt đầu lớp (yyyy-mm-dd), để trống = không áp dụng
  const [view, setView] = useState("home");
  const [showAdd, setShowAdd] = useState(false);
  const [loaded, setLoaded] = useState(false); // đã tải xong classIndex (đủ để hiện màn đăng nhập)
  const [classDataLoaded, setClassDataLoaded] = useState(false); // đã tải xong dữ liệu của lớp đang hoạt động
  // scoredEntries: chỉ gồm bài từ "Ngày bắt đầu lớp" trở đi — dùng cho MỌI tính điểm/dashboard/xếp hạng.
  // entries (đầy đủ, không lọc) vẫn giữ để hiện Lịch sử cá nhân và xuất Excel chi tiết.
  const scoredEntries = useMemo(() => filterByStartDate(entries, classStartDate), [entries, classStartDate]);
  const [saveError, setSaveError] = useState("");

  // Tải danh sách mã lớp (tài liệu nhỏ, không phụ thuộc đăng nhập)
  const loadClassIndex = useCallback(async () => {
    try {
      const ci = await storageGet(CLASS_INDEX_KEY).catch(() => null);
      setClassIndex(ci ? JSON.parse(ci.value) : []);
    } catch (err) {
      setSaveError("Không thể tải dữ liệu. Vui lòng tải lại trang.");
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => { loadClassIndex(); }, [loadClassIndex]);

  const registerClass = async (classCode) => {
    try {
      const next = await storageUpdate(CLASS_INDEX_KEY, (current) => {
        const list = current || [];
        return list.includes(classCode) ? list : [...list, classCode];
      });
      setClassIndex(next);
      return next;
    } catch (e) {
      setSaveError("Lỗi đăng ký lớp mới.");
      return classIndex;
    }
  };

  // Tải riêng dữ liệu (roster/entries/settings) của 1 lớp cụ thể
  const loadClassData = useCallback(async (classCode) => {
    setClassDataLoaded(false);
    try {
      const r = await storageGet(rosterKey(classCode)).catch(() => null);
      const e = await storageGet(entriesKey(classCode)).catch(() => null);
      const s = await storageGet(settingsKey(classCode)).catch(() => null);
      setRoster(r ? JSON.parse(r.value) : []);
      setEntries(e ? JSON.parse(e.value) : []);
      setDefaultPassword(s ? (JSON.parse(s.value).defaultPassword || "123456") : "123456");
      setClassStartDate(s ? (JSON.parse(s.value).classStartDate || "") : "");
    } catch (err) {
      setSaveError("Không thể tải dữ liệu lớp. Vui lòng thử lại.");
    } finally {
      setClassDataLoaded(true);
    }
  }, []);

  // persistRoster/persistEntries giờ nhận HÀM MÔ TẢ CÁCH SỬA (không phải mảng đã tính sẵn) —
  // storageUpdate sẽ tự lấy đúng dữ liệu MỚI NHẤT trên máy chủ ngay tại thời điểm ghi rồi mới áp
  // dụng thay đổi, nên dù có người khác vừa ghi thêm gì đó ngay trước đó cũng không bị mất.
  const persistRoster = async (mutatorFn) => {
    try {
      const next = await storageUpdate(rosterKey(user.classCode), (current) => mutatorFn(current || []));
      setRoster(next);
      return next;
    } catch (e) { setSaveError("Lỗi lưu danh sách."); }
  };
  const persistEntries = async (mutatorFn) => {
    try {
      const next = await storageUpdate(entriesKey(user.classCode), (current) => mutatorFn(current || []));
      setEntries(next);
      return next;
    } catch (e) { setSaveError("Lỗi lưu dữ liệu."); }
  };
  const persistSettings = async (pwd) => { setDefaultPassword(pwd); try { await storageSet(settingsKey(user.classCode), JSON.stringify({ defaultPassword: pwd, classStartDate })); } catch (e) { /* noop */ } };
  const persistClassStartDate = async (dateStr) => { setClassStartDate(dateStr); try { await storageSet(settingsKey(user.classCode), JSON.stringify({ defaultPassword, classStartDate: dateStr })); } catch (e) { /* noop */ } };

  // Học viên đăng nhập bằng User AD — chưa biết trước thuộc lớp nào, nên dò qua từng lớp trong classIndex
  const attemptLogin = async (username, password) => {
    for (const c of classIndex) {
      const r = await storageGet(rosterKey(c)).catch(() => null);
      if (!r) continue;
      const list = JSON.parse(r.value);
      const acc = list.find((u) => normUsername(u.username) === normUsername(username));
      if (acc) {
        if (acc.locked) return { error: "Tài khoản đã bị khóa. Vui lòng liên hệ Ban tổ chức." };
        if (acc.password !== password) return { error: "User AD hoặc mật khẩu không đúng." };
        setUser({ ...acc, isAdmin: false });
        await loadClassData(c);
        setView("home");
        return { ok: true };
      }
    }
    return { error: "User AD hoặc mật khẩu không đúng." };
  };

  const handleAdminLogin = async (classCode) => {
    setUser({ id: "admin", name: "Ban tổ chức", isAdmin: true, classCode });
    setView("admin");
    await registerClass(classCode);
    await loadClassData(classCode);
  };
  const switchAdminClass = async (classCode) => {
    setUser((u) => ({ ...u, classCode }));
    await registerClass(classCode);
    await loadClassData(classCode);
  };

  const handleSaveEntry = async ({ group, item, context, action, result }) => {
    const entry = { id: uid(), userId: user.id, userName: user.name, dept: user.dept, classCode: user.classCode, group, item, context, action, result, timestamp: Date.now(), likes: [] };
    await persistEntries((current) => [...current, entry]);
    setShowAdd(false);
  };
  const handleLike = (entryId) => {
    persistEntries((current) => current.map((e) => {
      if (e.id !== entryId) return e;
      const has = (e.likes || []).includes(user.id);
      return { ...e, likes: has ? e.likes.filter((id) => id !== user.id) : [...(e.likes || []), user.id] };
    }));
  };
  // Ban tổ chức xóa 1 bài ứng dụng — điểm/streak/bảng xếp hạng tự tính lại ngay vì đều tính động từ entries
  const deleteEntry = (entryId) => persistEntries((current) => current.filter((e) => e.id !== entryId));

  // Admin: account management actions — luôn thao tác trên đúng roster của lớp đang hoạt động
  const addAccount = ({ name, username, dept }) => persistRoster((current) => {
    if (current.some((u) => normUsername(u.username) === normUsername(username))) return current; // trùng User AD, bỏ qua
    return [...current, { id: uid(), name, username, dept, classCode: user.classCode, password: defaultPassword, locked: false }];
  });
  const bulkImport = async (parsed) => {
    let addedCount = 0;
    await persistRoster((current) => {
      const existing = new Set(current.map((u) => normUsername(u.username)));
      const toAdd = parsed.filter((p) => !existing.has(normUsername(p.username))).map((p) => ({ id: uid(), name: p.name, username: normUsername(p.username), dept: p.dept, classCode: user.classCode, password: defaultPassword, locked: false }));
      addedCount = toAdd.length;
      return [...current, ...toAdd];
    });
    return addedCount;
  };
  const toggleLock = (id) => persistRoster((current) => current.map((u) => (u.id === id ? { ...u, locked: !u.locked } : u)));
  const resetPassword = (id) => persistRoster((current) => current.map((u) => (u.id === id ? { ...u, password: defaultPassword } : u)));
  const deleteAccount = (id) => persistRoster((current) => current.filter((u) => u.id !== id));
  const deleteClassData = async () => {
    await persistRoster(() => []);
    await persistEntries(() => []);
    try {
      const next = await storageUpdate(CLASS_INDEX_KEY, (current) => (current || []).filter((c) => c !== user.classCode));
      setClassIndex(next);
    } catch (e) { setSaveError("Lỗi xóa mã lớp khỏi danh sách."); }
  };


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
        <LoginScreen classIndex={classIndex} onLoginAttempt={attemptLogin} onAdminLogin={handleAdminLogin} />
      </>
    );
  }
  if (!classDataLoaded) {
    return (
      <>
        <BrandStyles />
        <div className="min-h-screen flex items-center justify-center bg-white"><div className="animate-pulse brand-text font-medium text-sm">Đang tải dữ liệu lớp...</div></div>
      </>
    );
  }

  const navItems = user.isAdmin ? ADMIN_NAV : STUDENT_NAV;

  return (
    <div className="min-h-screen app-bg flex" style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>
      <BrandStyles />
      <Sidebar view={view} setView={setView} items={navItems} user={user} onLogout={() => setUser(null)} existingClasses={classIndex} onSwitchClass={switchAdminClass} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-end px-5 pt-3 md:hidden">
          <button onClick={() => setUser(null)} className="flex items-center gap-1 text-xs text-gray-400"><LogOut size={13} /> Đăng xuất</button>
        </div>
        {saveError && <div className="mx-5 md:mx-8 mt-3 md:mt-6 bg-red-50 accent-text text-xs px-3 py-2 rounded-lg">{saveError}</div>}

        {user.isAdmin ? (
          <>
            {view === "admin" && <AdminScreen entries={entries} scoredEntries={scoredEntries} roster={roster} classCode={user.classCode} classStartDate={classStartDate} onDeleteEntry={deleteEntry} />}
            {view === "accounts" && (
              <AdminAccountsScreen
                roster={roster} defaultPassword={defaultPassword} classStartDate={classStartDate} classCode={user.classCode}
                onAdd={addAccount} onBulkImport={bulkImport} onToggleLock={toggleLock}
                onResetPassword={resetPassword} onDelete={deleteAccount} onDefaultPasswordChange={persistSettings} onClassStartDateChange={persistClassStartDate} onDeleteClass={deleteClassData}
              />
            )}
            {view === "classes" && (
              <ClassesOverviewScreen
                classIndex={classIndex} currentClass={user.classCode}
                onSwitchClass={(c) => { switchAdminClass(c); setView("admin"); }}
                onGoToDashboard={() => setView("admin")}
              />
            )}
          </>
        ) : (
          <>
            {view === "home" && <HomeScreen user={user} entries={scoredEntries} roster={roster} onOpenAdd={() => setShowAdd(true)} onLike={handleLike} />}
            {view === "history" && <HistoryScreen user={user} entries={entries} />}
            {view === "leaderboard" && <LeaderboardScreen entries={scoredEntries} roster={roster} currentUserId={user.id} />}
          </>
        )}
      </div>

      {showAdd && <AddEntryScreen onSave={handleSaveEntry} onClose={() => setShowAdd(false)} />}
      <BottomNav view={view} setView={setView} items={navItems} />
    </div>
  );
}
