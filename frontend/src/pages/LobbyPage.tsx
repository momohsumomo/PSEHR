import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ClaimsPickDialog } from "@/components/clinic/ClaimsPickDialog";
import { IcDailyUploadDialog } from "@/components/clinic/IcDailyUploadDialog";
import { API_ENABLED, SANDBOX_ID } from "@/config/sandbox";
import { request, prefetchPatientRoster, syncLookNames } from "@/api/clinicApi";
import { AppUpdateDialog } from "@/components/clinic/AppUpdateDialog";
import { CardDeskTools } from "@/components/clinic/CardDeskTools";
import { DeskStatusLamps } from "@/components/clinic/DeskStatusLamps";
import { readLocalClinicBundle } from "@/lib/clinicProfile";

type ModuleBtn = {
  id: string;
  key: string;
  name: string;
  path: string;
  hint: string;
};

type MenuItem = {
  label: string;
  subItems?: { label: string; path: string }[];
};

function clinicCaption(): string {
  const name = readLocalClinicBundle().profile.clinicName?.trim() || "";
  const readable = /[\u4e00-\u9fff]/.test(name) && !name.includes("?");
  return readable ? name : "機構代碼 3521013662";
}

/** 開機主畫面。看診裡的醫聖式操作先留著，這裡用北極星自己的名字。 */
export function LobbyPage() {
  const navigate = useNavigate();
  const [currentTime, setCurrentTime] = useState("");
  const [pendingSync, setPendingSync] = useState<number | null>(null);
  const [syncError, setSyncError] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [claimsOpen, setClaimsOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [lookBusy, setLookBusy] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const clinicLine = useMemo(() => clinicCaption(), []);

  useEffect(() => {
    const open = searchParams.get("open");
    if (open !== "claims" && open !== "ic") return;
    if (open === "claims") setClaimsOpen(true);
    if (open === "ic") setUploadOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("open");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    prefetchPatientRoster();
  }, []);

  useEffect(() => {
    const updateTime = () => {
      const d = new Date();
      const yr = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, "0");
      const dy = String(d.getDate()).padStart(2, "0");
      const hr = String(d.getHours()).padStart(2, "0");
      const min = String(d.getMinutes()).padStart(2, "0");
      const sec = String(d.getSeconds()).padStart(2, "0");
      setCurrentTime(`${yr}.${mo}.${dy}  ${hr}:${min}:${sec}`);
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!API_ENABLED) return;
    const fetchSyncStatus = async () => {
      try {
        const data = await request<{ pending_sync_count?: number }>("/health");
        setPendingSync(data.pending_sync_count ?? null);
        setSyncError(false);
      } catch {
        setSyncError(true);
      }
    };
    void fetchSyncStatus();
    const interval = setInterval(() => void fetchSyncStatus(), 5000);
    return () => clearInterval(interval);
  }, []);

  const groups: Array<{ title: string; items: ModuleBtn[] }> = [
    {
      title: "看診",
      items: [
        { id: "patients", key: "1", name: "病患資料", path: "/patients", hint: "建檔、查找" },
        { id: "register", key: "2", name: "掛號作業", path: "/register", hint: "插卡、排隊" },
        { id: "clinic", key: "3", name: "診療作業", path: "/clinic", hint: "今日門診" },
        { id: "emr-lookup", key: "A", name: "調閱病歷", path: "/emr-lookup", hint: "依日期找人" },
      ],
    },
    {
      title: "藥與病名",
      items: [
        { id: "drugs", key: "4", name: "藥品資料", path: "/drugs", hint: "院內藥檔" },
        { id: "cc-templates", key: "5", name: "主訴症狀", path: "/cc-templates", hint: "常用主訴" },
        { id: "diagnoses-db", key: "6", name: "診斷資料", path: "/diagnoses-db", hint: "病名" },
        { id: "usages", key: "7", name: "用法資料", path: "/usages", hint: "頻率、天數" },
        { id: "packages", key: "8", name: "藥組資料", path: "/packages", hint: "常用組合" },
      ],
    },
    {
      title: "院所",
      items: [
        { id: "claims", key: "9", name: "申報作業", path: "/claims", hint: "先選項目" },
        { id: "billing", key: "0", name: "費用統計", path: "/billing", hint: "當日、區間" },
        { id: "clinic-profile", key: "B", name: "院所資料", path: "/clinic-profile", hint: "代碼、費用" },
        { id: "staff", key: "C", name: "人事資料", path: "/staff", hint: "醫師、藥師" },
        { id: "backup", key: "E", name: "備份作業", path: "/backup", hint: "把資料留一份" },
      ],
    },
  ];

  const modules = groups.flatMap((group) => group.items);

  const topMenus: MenuItem[] = [
    {
      label: "系統",
      subItems: [
        { label: "健保費用申報", path: "/claims" },
        { label: "院所資料", path: "/clinic-profile" },
        { label: "資料備份", path: "/backup" },
      ],
    },
    {
      label: "工具",
      subItems: [
        { label: "\u5c0d\u9f4a\u7167\u7247\u6a94\u540d", path: "look-sync" },
        { label: "影像管理", path: "/img-manager" },
        { label: "載入當日照護線上", path: "/register?care=today" },
        { label: "\u8b80\u5361\u4e26\u5b58\u6e2c\u8a66", path: "coexist-test" },
        { label: "電子轉診", path: "/referral" },
        { label: "候診預問診", path: "/kiosk/intake" },
        { label: "自助掛號", path: "/kiosk/register" },
        { label: "語音叫號", path: "/speaker" },
        { label: "IC 每日上傳", path: "/upload-manager" },
      ],
    },
    {
      label: "資料",
      subItems: [
        { label: "主訴症狀", path: "/cc-templates" },
        { label: "診斷資料", path: "/diagnoses-db" },
        { label: "用法資料", path: "/usages" },
        { label: "藥組資料", path: "/packages" },
      ],
    },
    {
      label: "統計",
      subItems: [
        { label: "費用統計", path: "/billing" },
        { label: "合理門診量", path: "/claims" },
      ],
    },
  ];

  const openModule = (path: string) => {
    setActiveMenu(null);
    if (path === "coexist-test") {
      void fetch("http://127.0.0.1:5310/tools/coexist-test", {
        method: "POST",
        signal: AbortSignal.timeout(80000),
      })
        .then(async (res) => {
          const data = (await res.json()) as {
            card6?: boolean;
            samStatus?: number;
            hpcStatus?: number;
            readerCount?: number;
            fiveRunning?: boolean;
            fiveBlocked?: boolean;
            samFile?: boolean;
            cloudCode?: number;
          };
          const sam =
            data.samStatus === 2
              ? "\u0036\u002e\u0030 \u7684 SAM \u5df2\u8a8d\u8b49\u3002"
              : "\u0036\u002e\u0030 \u7684 SAM \u72c0\u614b\u662f " + String(data.samStatus) + "\uff0c\u9084\u6c92\u8a8d\u8b49\u3002";
          const reader =
            (data.readerCount || 0) > 0
              ? "\u8b80\u5361\u6a5f\u6709 " + String(data.readerCount) + " \u53f0\u5728 \u0036\u002e\u0030 \u624b\u4e0a\u3002\u91ab\u4e8b\u4eba\u54e1\u5361\u72c0\u614b " + String(data.hpcStatus) + "\uff0c\u4e0d\u5f37\u6c42\u8a8d\u8b49\u3002"
              : "\u0036\u002e\u0030 \u6c92\u770b\u5230\u8b80\u5361\u6a5f\u3002";
          const five = !data.fiveRunning
            ? "\u0035\u002e\u0031\u002e\u0037 \u6c92\u958b\u3002"
            : data.fiveBlocked
              ? "\u95a9\u904e\u7684 \u0035\u002e\u0031\u002e\u0037 \u6b63\u5728\u8dd1\uff0c\u770b\u4e0d\u5230\u8b80\u5361\u6a5f\u3002"
              : "\u0035\u002e\u0031\u002e\u0037 \u958b\u8457\uff0c\u4f46\u9084\u770b\u5f97\u5230\u8b80\u5361\u6a5f\u3002";
          const cloud =
            data.cloudCode === 0
              ? "\u96f2\u7aef\u5143\u4ef6\u6e2c\u8a66\u6210\u529f\u3002\u8f49\u8a3a\u4e0b\u8f09\u8207\u8ad6\u8cea\u4e0a\u50b3\u7528\u7684\u662f\u540c\u4e00\u652f\u3002"
              : "\u96f2\u7aef\u5143\u4ef6\u6e2c\u8a66\u56de " + String(data.cloudCode) + "\u3002";
          const six = data.card6 ? "\u0036\u002e\u0030 \u958b\u8457\u3002" : "\u0036\u002e\u0030 \u6c92\u958b\u3002";
          const file = data.samFile ? "COMX1 \u6709 SAM \u6a94\u3002" : "COMX1 \u6c92\u6709 SAM \u6a94\u3002";
          window.alert([six, sam, reader, five, file, cloud, "\u6e2c\u8a66\u6c92\u6709\u9001\u51fa\u75c5\u4eba\u8cc7\u6599\u3002"].join("\n"));
        })
        .catch(() => {
          window.alert("\u9019\u53f0\u7684\u9580\u8a3a\u5de5\u5177\u6c92\u6709\u56de\u61c9\u3002\u8acb\u91cd\u958b\u958b\u555f\u9580\u8a3a\u3002");
        });
      return;
    }
    if (path === "look-sync") {
      if (lookBusy) return;
      setLookBusy(true);
      void syncLookNames()
        .then((res) => {
          if (!res.reachable) {
            window.alert("\u76f8\u7247\u8cc7\u6599\u593e\u8b80\u4e0d\u5230\uff0c\u6a94\u540d\u6c92\u6709\u88dc\u3002");
            return;
          }
          window.alert(
            "\u5c0d\u9f4a\u5b8c\u6210\u3002\u9019\u6b21\u88dc\u9032 " +
              String(res.added) +
              " \u7b46\u6a94\u540d\uff0c\u5716\u5eab\u88e1\u5171 " +
              String(res.scanned) +
              " \u7b46\u3002\u6c92\u6709\u522a\u7167\u7247\uff0c\u4e5f\u6c92\u6709\u628a\u5716\u6a94\u672c\u9ad4\u5beb\u9032\u75c5\u6b77\u3002",
          );
        })
        .catch((err: unknown) => {
          window.alert(err instanceof Error ? err.message : "\u5c0d\u9f4a\u7167\u7247\u5931\u6557");
        })
        .finally(() => setLookBusy(false));
      return;
    }
    if (path === "/claims") {
      setClaimsOpen(true);
      return;
    }
    if (path === "/upload-manager") {
      setUploadOpen(true);
      return;
    }
    if (path === "/kiosk/register" || path === "/kiosk/intake") {
      const target = path === "/kiosk/intake" ? "intake" : "kiosk";
      void request<{ ok: boolean }>("/maintenance/desktop-window", {
        method: "POST",
        body: JSON.stringify({ target }),
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "\u8996\u7a97\u6c92\u958b\u8d77\u4f86\u3002";
        window.alert(msg);
      });
      return;
    }
    navigate(path);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }
      const char = e.key.toUpperCase();
      const matched = modules.find((m) => m.key.toUpperCase() === char);
      if (matched) {
        e.preventDefault();
        openModule(matched.path);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const syncLabel = !API_ENABLED
    ? `預覽 · ${SANDBOX_ID}`
    : syncError
      ? "同步中斷"
      : pendingSync === 0
        ? "資料已同步"
        : `${pendingSync ?? "…"} 筆待同步`;

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden text-[#E7EEF8]"
      style={{ fontFamily: '"Microsoft JhengHei", "Segoe UI", sans-serif' }}
      onClick={() => setActiveMenu(null)}
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(900px 520px at 12% -10%, #243456 0%, transparent 55%), radial-gradient(700px 480px at 100% 100%, #1a2744 0%, transparent 50%), #0e1420",
        }}
      />

      <nav className="relative z-20 flex shrink-0 items-center gap-1 border-b border-white/10 px-4 py-2">
        {topMenus.map((menu) => (
          <div key={menu.label} className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="rounded px-2.5 py-1 text-[13px] text-[#C5D2E6] hover:bg-white/10"
              style={{ background: activeMenu === menu.label ? "rgba(255,255,255,.1)" : "transparent" }}
              onClick={() => setActiveMenu(activeMenu === menu.label ? null : menu.label)}
              onMouseEnter={() => activeMenu && setActiveMenu(menu.label)}
            >
              {menu.label}
            </button>
            {activeMenu === menu.label && menu.subItems && (
              <div className="absolute left-0 top-full z-30 min-w-[12rem] rounded-md border border-white/10 bg-[#151c2c] py-1 shadow-lg">
                {menu.subItems.map((sub) => (
                  <button
                    key={sub.label}
                    type="button"
                    className="block w-full px-3 py-1.5 text-left text-[13px] text-[#E7EEF8] hover:bg-white/10"
                    onClick={() => openModule(sub.path)}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        <span className="ml-auto text-[12px] text-[#8EA0BA]">鍵盤 1–9、0、A、B、C、E</span>
        <CardDeskTools variant="dark" />
      </nav>

      <header className="relative z-10 flex shrink-0 items-end gap-6 px-8 pb-2 pt-6">
        <div className="flex items-start gap-4">
          <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden className="mt-1 shrink-0">
            <path
              d="M18 2.5 L20.2 14.2 L32 18 L20.2 21.8 L18 33.5 L15.8 21.8 L4 18 L15.8 14.2 Z"
              fill="#E7D7A8"
            />
          </svg>
          <div>
            <div className="text-[12px] font-medium tracking-[0.28em] text-[#9EB0C9]">
              POLARIS SOVEREIGN EHR
            </div>
            <h1 className="mt-1 text-[32px] font-semibold leading-tight tracking-wide text-white">
              北極星自主電子病歷系統
            </h1>
            <p className="mt-1 text-[14px] text-[#A9B8CE]">{clinicLine}</p>
          </div>
        </div>
        <div className="ml-auto mb-1">
          <DeskStatusLamps
            sync={syncError ? "bad" : pendingSync == null ? "wait" : "ok"}
            syncHint={syncLabel}
          />
        </div>
      </header>

      <main className="relative z-10 min-h-0 flex-1 overflow-y-auto px-8 pb-6 pt-4">
        <div className="grid grid-cols-3 content-start gap-8">
        {groups.map((group) => (
          <section key={group.title} className="min-w-0">
            <h2 className="mb-3 text-[12px] font-medium tracking-[0.18em] text-[#8EA0BA]">{group.title}</h2>
            <div className="flex flex-col gap-2">
              {group.items.map((btn) => (
                <button
                  key={btn.id}
                  type="button"
                  className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.045] px-4 py-3 text-left transition hover:border-[#E7D7A8]/50 hover:bg-white/[0.08]"
                  onClick={() => openModule(btn.path)}
                >
                  <span className="w-6 shrink-0 text-[15px] font-semibold text-[#9EBAE8]">{btn.key}</span>
                  <span className="min-w-0">
                    <span className="block text-[16px] font-medium text-white">{btn.name}</span>
                    <span className="block text-[12px] text-[#8EA0BA]">{btn.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
        </div>
      </main>

      <footer className="relative z-20 flex shrink-0 items-center justify-end border-t border-white/10 px-8 py-2 text-[12px] text-[#8EA0BA]">
        <span className="flex items-center gap-3">
          <button
            type="button"
            className="rounded border border-white/15 px-2 py-0.5 text-[12px] text-[#E7D7A8] hover:bg-white/10"
            onClick={() => setUpdateOpen(true)}
          >
            {"\u66f4\u65b0"}
          </button>
          <span className="font-mono text-[#C5D2E6]">{currentTime}</span>
        </span>
      </footer>
      <ClaimsPickDialog
        open={claimsOpen}
        onClose={() => setClaimsOpen(false)}
        onDaily={() => {
          setClaimsOpen(false);
          setUploadOpen(true);
        }}
        onCheck={() => {
          setClaimsOpen(false);
          navigate("/claims?job=check");
        }}
        onBuild={() => {
          setClaimsOpen(false);
          navigate("/claims?job=build");
        }}
      />
      <IcDailyUploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <AppUpdateDialog open={updateOpen} onClose={() => setUpdateOpen(false)} />
    </div>
  );
}
