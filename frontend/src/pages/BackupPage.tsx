import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useEscLayer } from "@/hooks/useEscLayer";
import {
  fetchBackupInfo,
  isApiMode,
  runBackupNow,
  saveBackupSettings,
  type BackupInfo,
} from "@/api/clinicApi";


const BROWSER_SETTING_KEYS = [
  "wundadi-clinic-profile-page-v2",
  "wundadi-clinic-profile-page",
  "wundadi-clinic-settings-v1",
  "wundadi-cc-templates",
  "wundadi.printSettings.v1",
];

function browserSettingsPayload(): Record<string, string | null> {
  const out: Record<string, string | null> = { exportedAt: new Date().toISOString() };
  for (const key of BROWSER_SETTING_KEYS) out[key] = localStorage.getItem(key);
  return out;
}

function gb(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function when(iso: string | undefined | null): string {
  if (!iso) return "—";
  return iso.replace("T", " ").slice(0, 19);
}

/** 醫聖 &B 資料備份：把影子庫整份複製到指定資料夾（看診中也可以按）。 */
export function BackupPage() {
  const navigate = useNavigate();
  useEscLayer([{ open: true, close: () => navigate("/") }]);
  const apiMode = isApiMode();
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [dir, setDir] = useState("");
  const [keep, setKeep] = useState(7);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const apply = useCallback((next: BackupInfo) => {
    setInfo(next);
    setDir(next.settings.dir);
    setKeep(next.settings.keep);
  }, []);

  const reload = useCallback(async () => {
    if (!apiMode) return;
    try {
      const next = await fetchBackupInfo();
      setInfo(next);
      setError(null);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : "讀不到備份狀態");
      return undefined;
    }
  }, [apiMode]);

  useEffect(() => {
    if (!apiMode) return;
    void fetchBackupInfo()
      .then(apply)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "讀不到備份狀態"));
  }, [apiMode, apply]);

  const running = Boolean(info?.state.running);

  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => {
      void reload();
    }, 2000);
    return () => window.clearInterval(t);
  }, [running, reload]);

  const handleSave = async () => {
    setSaving(true);
    setNotice(null);
    try {
      apply(await saveBackupSettings({ dir: dir.trim(), keep }));
      setNotice("已存備份設定。");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "存設定失敗");
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async () => {
    setNotice(null);
    try {
      if (info && (dir.trim() !== info.settings.dir || keep !== info.settings.keep)) {
        apply(await saveBackupSettings({ dir: dir.trim(), keep }));
      }
      setInfo(await runBackupNow(browserSettingsPayload()));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "備份沒有開始");
    }
  };

  const handleExportLocal = () => {
    const payload = browserSettingsPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wundadi-本機設定-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice("已下載這台電腦的本機設定（列印、主訴暫存等）。病歷資料在影子庫備份裡。");
  };

  const state = info?.state;
  const lastOk = info?.settings.lastOk;
  const lowSpace = info && info.freeBytes != null && info.freeBytes < info.dbBytes * 1.1;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 p-6 flex flex-col font-sans">
      <header className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition"
          >
            <span>🏠</span> 回主選單
          </button>
          <div className="h-5 w-[1px] bg-slate-300" />
          <div>
            <h1 className="text-lg font-black tracking-wide text-slate-800">資料備份（S 系統工具）</h1>
            <p className="text-[10px] text-slate-500">
              一次備份會存兩樣：影子庫（病人、看診、處方、診斷、人員、系統設定），以及這台電腦的畫面設定（診所資料、列印、主訴範本）。看診中也可以按。相片資料夾不會整包複製進來。
            </p>
          </div>
        </div>
      </header>

      {!apiMode && (
        <p className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          目前是展示模式（沒有接後端），不能備份影子庫。
        </p>
      )}
      {error && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>
      )}
      {notice && (
        <p className="mb-4 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">{notice}</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 flex-1 min-h-0">
        <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col gap-4 h-fit">
          <h2 className="text-sm font-bold text-slate-800 border-b pb-2">備份設定</h2>
          <label className="block text-xs">
            <span className="mb-1 block font-bold text-slate-600">備份資料夾（完整路徑）</span>
            <input
              className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs"
              value={dir}
              placeholder="例如 E:\Wundadi備份"
              onChange={(e) => setDir(e.target.value)}
              disabled={!apiMode}
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-bold text-slate-600">保留最近幾份</span>
            <input
              type="number"
              min={1}
              max={60}
              className="w-24 rounded border border-slate-300 px-2 py-1.5 text-xs"
              value={keep}
              onChange={(e) => setKeep(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
              disabled={!apiMode}
            />
            <span className="ml-2 text-slate-500">超過就刪最舊的（只刪本功能做的備份檔）</span>
          </label>
          {info?.sameDrive && (
            <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-900">
              備份資料夾和資料庫在同一顆硬碟。硬碟壞掉時兩份會一起不見，建議改到隨身硬碟、另一顆硬碟或 NAS。
            </p>
          )}
          {lowSpace && (
            <p className="rounded border border-red-300 bg-red-50 px-2 py-1.5 text-[11px] text-red-800">
              備份位置剩 {gb(info?.freeBytes)}，資料庫有 {gb(info?.dbBytes)}，空間不夠。
            </p>
          )}
          <div className="space-y-1.5 text-xs text-slate-600">
            <div className="flex justify-between">
              <span>資料庫大小：</span>
              <span className="font-mono font-bold">{gb(info?.dbBytes)}</span>
            </div>
            <div className="flex justify-between">
              <span>備份位置剩餘空間：</span>
              <span className="font-mono font-bold">{gb(info?.freeBytes)}</span>
            </div>
            <div className="flex justify-between">
              <span>上次成功備份：</span>
              <span className="font-mono font-bold">{when(lastOk?.at)}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!apiMode || saving || running}
              onClick={() => void handleSave()}
              className="flex-1 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 font-bold text-xs disabled:opacity-50"
            >
              存設定
            </button>
            <button
              type="button"
              disabled={!apiMode || running}
              onClick={() => void handleRun()}
              className="flex-[2] py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white font-bold text-xs shadow-sm disabled:opacity-50"
            >
              {running ? "備份中…" : "立刻備份"}
            </button>
          </div>
          <button
            type="button"
            onClick={handleExportLocal}
            className="w-full py-1.5 rounded-lg border border-slate-300 bg-white text-slate-600 text-[11px]"
          >
            另存這台電腦的本機設定（JSON）
          </button>
        </section>

        <section className="md:col-span-2 bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col min-h-0">
          <h2 className="text-sm font-bold text-slate-800 border-b pb-2 mb-3">備份狀態</h2>
          <div className="mb-3 rounded-lg bg-slate-950 p-3 font-mono text-xs text-emerald-400 space-y-1">
            {!state || (!state.running && state.ok == null) ? (
              <p className="text-slate-400">這次開機後還沒有備份過。</p>
            ) : state.running ? (
              <p>備份中…（{when(state.startedAt)} 開始）。資料庫越大越久，看診可以照常。</p>
            ) : state.ok ? (
              <>
                <p>完成：{state.file}</p>
                <p>
                  {gb(state.bytes)}，花 {state.seconds} 秒（{when(state.finishedAt)}）
                </p>
                {state.removed.length > 0 && <p className="text-slate-400">已刪舊備份：{state.removed.join("、")}</p>}
              </>
            ) : (
              <p className="text-red-400">失敗：{state.message}</p>
            )}
          </div>
          <h3 className="mb-1 text-xs font-bold text-slate-600">
            這個資料夾裡的備份（{info?.files.length ?? 0} 份）
          </h3>
          <div className="min-h-0 flex-1 overflow-auto rounded border border-slate-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-100 text-slate-600">
                <tr>
                  <th className="px-2 py-1 text-left">檔名</th>
                  <th className="px-2 py-1 text-right">大小</th>
                  <th className="px-2 py-1 text-left">時間</th>
                </tr>
              </thead>
              <tbody>
                {(info?.files ?? []).map((f) => (
                  <tr key={f.name} className="border-t border-slate-100">
                    <td className="px-2 py-1 font-mono">{f.name}</td>
                    <td className="px-2 py-1 text-right font-mono">{gb(f.bytes)}</td>
                    <td className="px-2 py-1 font-mono">{when(f.modifiedAt)}</td>
                  </tr>
                ))}
                {!info?.files.length && (
                  <tr>
                    <td colSpan={3} className="px-2 py-3 text-center text-slate-400">
                      還沒有備份檔
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] leading-snug text-slate-500">
            還原：關掉門診系統，把備份的 shadow-日期.db 改名為 shadow.db 蓋掉 data\shadow.db（先把原本改名留著），再重新啟動。旁邊的 .settings.json 是設定明細。相片檔在相簿資料夾，沒有放進這份備份。
          </p>
        </section>
      </div>
    </div>
  );
}
