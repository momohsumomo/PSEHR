import { useEffect, useState } from "react";
import { HisDataGrid, HisXpDialog } from "@/components/clinic/HisPageFrame";
import { HisRocDateField, rocToIso, todayRoc } from "@/components/clinic/HisRocDatePicker";
import {
  fetchIcUploadHistory,
  isApiMode,
  sendIcUpload,
  type IcUploadHistoryRow,
} from "@/api/clinicApi";

type Props = {
  open: boolean;
  onClose: () => void;
};

function daysInRange(startRoc: string, endRoc: string): string[] {
  const a = rocToIso(startRoc);
  const b = rocToIso(endRoc);
  if (!a || !b) return [];
  const from = a <= b ? a : b;
  const to = a <= b ? b : a;
  const out: string[] = [];
  const cur = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cur.getTime() <= end.getTime() && out.length < 32) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

const COLS = [
  { key: "uploadDate", label: "上傳日期", width: 78 },
  { key: "uploadTime", label: "時間", width: 68, mono: true },
  { key: "startDate", label: "起始", width: 72 },
  { key: "endDate", label: "截止", width: 72 },
  { key: "receiveDate", label: "接收日期", width: 78 },
  { key: "receiveTime", label: "接收時間", width: 68, mono: true },
  { key: "uploadCount", label: "上傳總數", width: 64, mono: true },
  { key: "receiveCount", label: "接收總數", width: 64, mono: true },
  { key: "kind", label: "資料型態", width: 64 },
];

/** 資料上傳作業。點 IC上傳就用院所安全模組送出。 */
export function IcDailyUploadDialog({ open, onClose }: Props) {
  const [start, setStart] = useState(todayRoc);
  const [end, setEnd] = useState(todayRoc);
  const [rows, setRows] = useState<IcUploadHistoryRow[]>([]);
  const [pct, setPct] = useState(0);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const today = todayRoc();
    setStart(today);
    setEnd(today);
    setPct(0);
    setStatus("");
    if (!isApiMode()) {
      setRows([]);
      return;
    }
    let alive = true;
    void fetchIcUploadHistory()
      .then((list) => {
        if (alive) setRows(list);
      })
      .catch(() => {
        if (alive) setRows([]);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const onUpload = async () => {
    const days = daysInRange(start, end);
    if (days.length === 0) {
      setStatus("日期還沒填好。");
      return;
    }
    if (days.length > 31) {
      setStatus("一次最多三十一天。");
      return;
    }
    setBusy(true);
    setStatus("正在送給健保署，請稍候。");
    let sent = 0;
    try {
      for (let i = 0; i < days.length; i += 1) {
        setPct(Math.round((i / days.length) * 100));
        const result = await sendIcUpload(days[i]);
        if (!result.ok) {
          const reason = result.reason || "";
          if (reason.includes("沒有要上傳") && days.length > 1) continue;
          throw new Error(reason || "沒有送到健保署");
        }
        sent += result.count || 0;
      }
      setPct(100);
      setStatus(
        sent > 0
          ? `已送到健保署，${sent} 筆。`
          : "這段日期沒有要上傳的健保就醫。",
      );
      const list = await fetchIcUploadHistory();
      setRows(list);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "沒有送到健保署");
    } finally {
      setBusy(false);
    }
  };

  return (
    <HisXpDialog open={open} title="資料上傳作業" onClose={onClose} width={760}>
      <div className="flex flex-col gap-2 text-[13px] text-black">
        <div className="flex flex-wrap items-center gap-2">
          <span>{"上傳資料起始日"}</span>
          <HisRocDateField value={start} onChange={setStart} />
          <span>~</span>
          <span>{"上傳資料截止日"}</span>
          <HisRocDateField value={end} onChange={setEnd} />
        </div>
        <div
          className="relative h-5 border text-center leading-5"
          style={{ borderColor: "#808080", background: "#fff" }}
        >
          <div className="absolute inset-y-0 left-0 bg-[#c5ddb5]" style={{ width: `${pct}%` }} />
          <span className="relative">{pct}%</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            className="border px-3 py-1 font-bold disabled:opacity-50"
            style={{ borderColor: "#404040", background: "#ece9d8" }}
            onClick={() => void onUpload()}
          >
            {"IC上傳"}
          </button>
          <button
            type="button"
            className="border px-3 py-1 font-bold"
            style={{ borderColor: "#404040", background: "#ece9d8" }}
            onClick={onClose}
          >
            {"離開"}
          </button>
          {status ? <span className="text-[12px] text-slate-700">{status}</span> : null}
        </div>
        <div className="text-[12px] font-bold">{"IC上傳紀錄"}</div>
        <div className="h-72 border" style={{ borderColor: "#808080" }}>
          <HisDataGrid
            columns={COLS}
            rows={rows}
            rowKey={(row, index) => `${row.uploadDate}-${row.uploadTime}-${row.startDate}-${index}`}
            selectedKey={picked}
            onSelect={(row) =>
              setPicked(`${row.uploadDate}-${row.uploadTime}-${row.startDate}-${rows.indexOf(row)}`)
            }
            cell={(row, key) => String(row[key as keyof IcUploadHistoryRow] ?? "")}
            emptyText={"尚無上傳紀錄"}
          />
        </div>
      </div>
    </HisXpDialog>
  );
}
