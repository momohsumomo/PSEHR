import { useMemo, useState } from "react";

interface OutpatientQueueTableProps {
  queue: any[];
  currentDate: string;
  setCurrentDate: (date: string) => void;
  setSelectedEncounterId: (id: string | null) => void;
  onStatusChange: (encounterId: string, status: any) => Promise<void>;
  navigate: (path: string) => void;
}

export function OutpatientQueueTable({
  queue,
  currentDate,
  setCurrentDate,
  setSelectedEncounterId,
  onStatusChange,
  navigate,
}: OutpatientQueueTableProps) {
  const [queueSearch, setQueueSearch] = useState("");
  const [shiftFilter, setShiftFilter] = useState("all");
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const shiftDate = (offset: number) => {
    const cur = new Date(currentDate);
    if (isNaN(cur.getTime())) return;
    cur.setDate(cur.getDate() + offset);
    const yr = cur.getFullYear();
    const mo = String(cur.getMonth() + 1).padStart(2, "0");
    const dy = String(cur.getDate()).padStart(2, "0");
    setCurrentDate(`${yr}-${mo}-${dy}`);
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const renderSortIndicator = (field: string) => {
    if (sortField !== field) return " ↕";
    return sortAsc ? " ▲" : " ▼";
  };

  const filteredQueue = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    let res = queue;
    if (q) {
      res = queue.filter((e) => {
        const blob = [
          e.patientDisplay,
          e.medicalNo,
          e.reasonText,
          e.ageSex,
          String(e.queueNumber),
        ]
          .join(" ")
          .toLowerCase();
        return blob.includes(q);
      });
    }

    // 時段過濾
    if (shiftFilter !== "all") {
      res = res.filter((e) => {
        const timeLabel = e.slotTime ?? "09:00";
        const hour = timeLabel.includes(":") ? parseInt(timeLabel.split(":")[0]) : 9;
        if (shiftFilter === "morning") return hour < 12;
        if (shiftFilter === "afternoon") return hour >= 12 && hour < 18;
        if (shiftFilter === "evening") return hour >= 18;
        return true;
      });
    }
    return res;
  }, [queue, queueSearch, shiftFilter]);

  const sortedQueue = useMemo(() => {
    const sorted = [...filteredQueue].sort((a: any, b: any) => {
      if (!sortField) return 0;
      let valA = a[sortField];
      let valB = b[sortField];
      
      if (sortField === "age") {
        valA = parseInt(a.age ?? a.ageSex.replace(/[MF]$/, "")) || 0;
        valB = parseInt(b.age ?? b.ageSex.replace(/[MF]$/, "")) || 0;
      }
      
      if (valA === undefined || valA === null) return 1;
      if (valB === undefined || valB === null) return -1;
      
      if (typeof valA === "string") {
        return valA.localeCompare(valB, "zh-Hant");
      }
      return valA - valB;
    });
    return sortAsc ? sorted : sorted.reverse();
  }, [filteredQueue, sortField, sortAsc]);

  return (
    <div className="min-h-screen bg-slate-200 p-4 flex flex-col font-sans select-none">
      {/* Header */}
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition shadow-sm"
          >
            <span>🏠</span> 回主選單
          </button>
          <div className="h-5 w-[1px] bg-slate-300" />
          <div>
            <h1 className="text-lg font-bold text-slate-900">今日門診診療作業</h1>
            <p className="text-xs text-slate-600">對齊醫盛 DoctBrw.Set 21 欄規格候診清單</p>
          </div>
        </div>
        <span className="rounded-full px-3 py-1 text-xs font-medium bg-slate-800 text-white">
          第一階段 · 候診名單
        </span>
      </header>

      {/* DoctBrw Table Dashboard */}
      <div className="flex-1 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col p-4">
        <div className="flex flex-wrap items-center justify-between border-b pb-2 mb-3 gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-bold text-slate-800 text-sm select-none">
              診療候診清單
            </span>
            
            {/* 日期選擇器 */}
            <div className="flex items-center gap-1 bg-slate-100 border border-slate-250 rounded-lg p-0.5 select-none">
              <button
                type="button"
                onClick={() => shiftDate(-1)}
                className="px-2 py-0.5 text-[10px] font-bold bg-white border border-slate-200 rounded shadow-sm hover:bg-slate-50 transition"
              >
                ◀ 前一天
              </button>
              <input
                type="date"
                value={currentDate}
                onChange={(e) => setCurrentDate(e.target.value)}
                className="px-1.5 py-0.5 text-xs font-bold border border-slate-255 rounded bg-white font-mono focus:outline-none"
              />
              <button
                type="button"
                onClick={() => shiftDate(1)}
                className="px-2 py-0.5 text-[10px] font-bold bg-white border border-slate-200 rounded shadow-sm hover:bg-slate-50 transition"
              >
                後一天 ▶
              </button>
              <button
                type="button"
                onClick={() => {
                  const todayStr = new Date().toISOString().split("T")[0];
                  setCurrentDate(todayStr);
                }}
                className="px-2 py-0.5 text-[10px] font-bold bg-sky-100 hover:bg-sky-200 border border-sky-300 rounded text-sky-850 transition"
              >
                今日
              </button>
            </div>

            {/* 時段過濾器 */}
            <div className="flex items-center gap-1 bg-slate-100 border border-slate-250 rounded-lg p-0.5 select-none">
              <span className="text-[10px] font-bold text-slate-500 px-1">時段:</span>
              <select
                value={shiftFilter}
                onChange={(e) => setShiftFilter(e.target.value)}
                className="bg-white border border-slate-250 rounded text-xs px-1 py-0.5 font-bold focus:outline-none"
              >
                <option value="all">全部時段</option>
                <option value="morning">上午診 (12:00前)</option>
                <option value="afternoon">下午診 (12:00-18:00)</option>
                <option value="evening">晚上診 (18:00後)</option>
              </select>
            </div>
          </div>
          <input
            type="search"
            placeholder="🔍 搜尋姓名 / 病歷號 / 主述..."
            value={queueSearch}
            onChange={(e) => setQueueSearch(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none w-52"
          />
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-[11px] font-medium text-slate-700 whitespace-nowrap">
            <thead className="bg-slate-50 sticky top-0 border-b border-slate-200 z-10 text-slate-600 select-none text-[10px]">
              <tr>
                <th className="px-3 py-2 text-left cursor-pointer hover:bg-slate-100 transition" onClick={() => handleSort("queueNumber")}>序號{renderSortIndicator("queueNumber")}</th>
                <th className="px-3 py-2 text-left cursor-pointer hover:bg-slate-100 transition" onClick={() => handleSort("slotTime")}>時間{renderSortIndicator("slotTime")}</th>
                <th className="px-3 py-2 text-left cursor-pointer hover:bg-slate-100 transition" onClick={() => handleSort("medicalNo")}>病歷號{renderSortIndicator("medicalNo")}</th>
                <th className="px-3 py-2 text-left cursor-pointer hover:bg-slate-100 transition" onClick={() => handleSort("patientDisplay")}>姓名{renderSortIndicator("patientDisplay")}</th>
                <th className="px-3 py-2 text-left cursor-pointer hover:bg-slate-100 transition" onClick={() => handleSort("age")}>年齡{renderSortIndicator("age")}</th>
                <th className="px-3 py-2 text-left cursor-pointer hover:bg-slate-100 transition" onClick={() => handleSort("sex")}>性別{renderSortIndicator("sex")}</th>
                <th className="px-3 py-2 text-left">時段</th>
                <th className="px-3 py-2 text-left">註</th>
                <th className="px-3 py-2 text-left">預</th>
                <th className="px-3 py-2 text-left">案</th>
                <th className="px-3 py-2 text-right">自付</th>
                <th className="px-3 py-2 text-right">掛費</th>
                <th className="px-3 py-2 text-right">藥費</th>
                <th className="px-3 py-2 text-right">已收</th>
                <th className="px-3 py-2 text-center cursor-pointer hover:bg-slate-100 transition" onClick={() => handleSort("queueStatus")}>狀態{renderSortIndicator("queueStatus")}</th>
                <th className="px-3 py-2 text-left">備註記載</th>
                <th className="px-3 py-2 text-left">天數</th>
                <th className="px-3 py-2 text-left">ICD9</th>
                <th className="px-3 py-2 text-left">病名</th>
                <th className="px-3 py-2 text-left">電話</th>
                <th className="px-3 py-2 text-left">地址</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedQueue.map((e) => {
                const isFinished = e.queueStatus === "finished";
                const isCalling = e.queueStatus === "in_progress";
                const timeLabel = e.slotTime ?? "09:00";
                const hour = timeLabel.includes(":") ? parseInt(timeLabel.split(":")[0]) : 9;
                const shift = hour < 12 ? "上午" : "下午";
                const ageLabel = e.age ?? e.ageSex.replace(/[MF]$/, "");
                const sexLabel = e.sex === "M" || e.ageSex.endsWith("M") ? "男" : "女";

                return (
                  <tr
                    key={e.encounterId}
                    className={`cursor-pointer hover:bg-sky-50/50 transition ${
                      isCalling ? "bg-green-50/70" : isFinished ? "bg-slate-50/40 text-slate-400" : ""
                    }`}
                    onDoubleClick={() => {
                      setSelectedEncounterId(e.encounterId);
                      if (e.queueStatus === "waiting") {
                        onStatusChange(e.encounterId, "in_progress");
                      }
                    }}
                  >
                    <td className="px-3 py-2.5 font-mono">#{e.queueNumber}</td>
                    <td className="px-3 py-2.5 font-mono">{timeLabel}</td>
                    <td className="px-3 py-2.5 font-mono">{e.medicalNo}</td>
                    <td className="px-3 py-2.5 font-bold text-slate-900">{e.patientDisplay}</td>
                    <td className="px-3 py-2.5 font-mono">{ageLabel}</td>
                    <td className="px-3 py-2.5">{sexLabel}</td>
                    <td className="px-3 py-2.5">{shift}</td>
                    <td className="px-3 py-2.5">一般</td>
                    <td className="px-3 py-2.5">{e.preVisitCompleted ? "已預" : "N"}</td>
                    <td className="px-3 py-2.5">{e.hasAllergyAlert ? "自費" : "01"}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{e.hasAllergyAlert ? 300 : 50}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{e.hasAllergyAlert ? 0 : 150}</td>
                    <td className="px-3 py-2.5 text-right font-mono">0</td>
                    <td className="px-3 py-2.5 text-right font-mono">{e.hasAllergyAlert ? 300 : 200}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-black ${
                          isCalling
                            ? "bg-green-600 text-white"
                            : isFinished
                              ? "bg-slate-300 text-slate-600"
                              : "bg-slate-200 text-slate-800"
                        }`}
                      >
                        {isCalling ? "看診中" : isFinished ? "已完診" : "候診中"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 max-w-xs truncate text-slate-500">{e.reasonText || "門診登記"}</td>
                    <td className="px-3 py-2.5 font-mono">{e.rxDays || "—"}</td>
                    <td className="px-3 py-2.5 font-mono">{e.icdCode || "—"}</td>
                    <td className="px-3 py-2.5 truncate max-w-xs">{e.diseaseName || "—"}</td>
                    <td className="px-3 py-2.5 font-mono">{e.phone || "—"}</td>
                    <td className="px-3 py-2.5 truncate max-w-xs">{e.address || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 border-t pt-2 text-[10px] text-slate-500 flex justify-between">
          <span>💡 雙擊病患即可快速進入「專注看診病歷」視窗</span>
          <span>Wundadi 門診</span>
        </div>
      </div>
    </div>
  );
}
