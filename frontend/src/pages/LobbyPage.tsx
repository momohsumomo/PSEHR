import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ClaimsPickDialog } from "@/components/clinic/ClaimsPickDialog";
import { IcDailyUploadDialog } from "@/components/clinic/IcDailyUploadDialog";
import { API_ENABLED, SANDBOX_ID } from "@/config/sandbox";
import { request, fetchCardConsoleStatus, prefetchPatientRoster, type CardConsoleStatus } from "@/api/clinicApi";
import { CardConsoleDebugButton } from "@/components/clinic/CardConsoleDebugButton";
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
  const [cardStatus, setCardStatus] = useState<CardConsoleStatus | null>(null);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [claimsOpen, setClaimsOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
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

  useEffect(() => {
    if (!API_ENABLED) return;
    const load = async () => {
      try {
        setCardStatus(await fetchCardConsoleStatus());
      } catch {
        setCardStatus({ reachable: false, advice: ["後端 API 連不到，無法問 6.0 主控台。"] });
      }
    };
    void load();
    const interval = setInterval(() => void load(), 8000);
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
        { label: "影像管理", path: "/img-manager" },
        { label: "載入當日照護線上", path: "/register?care=today" },
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

  const cardLabel =
    cardStatus?.reachable === false
      ? "讀卡機離線"
      : cardStatus?.reachable
        ? "讀卡機已連上"
        : "讀卡機 —";

  const syncLabel = !API_ENABLED
    ? `預覽 · ${SANDBOX_ID}`
    : syncError
      ? "同步中斷"
      : pendingSync === 0
        ? "資料已同步"
        : `${pendingSync ?? "…"} 筆待同步`;

  return (
    <div
      className="relative flex h-screen flex-col overflow-hidden text-[#E7EEF8]"
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
      </nav>

      <header className="relative z-10 flex items-end gap-6 px-8 pb-2 pt-8">
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
      </header>

      <main className="relative z-10 grid grid-cols-3 content-start gap-8 px-8 pb-10 pt-5">
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
      </main>

      <footer className="relative z-20 mt-auto flex shrink-0 items-center justify-between border-t border-white/10 px-8 py-2 text-[12px] text-[#8EA0BA]">
        <span className="flex flex-wrap items-center gap-3">
          <DeskStatusLamps
            card={cardStatus == null ? "wait" : cardStatus.reachable ? "ok" : "bad"}
            cardHint={cardLabel}
            sync={syncError ? "bad" : pendingSync == null ? "wait" : "ok"}
            syncHint={syncLabel}
          />
          <CardConsoleDebugButton
            compact
            variant="dark"
            label={"\u8b80\u5361\u9664\u932f"}
            onFixed={(status) => {
              if (status) setCardStatus(status);
            }}
          />
        </span>
        <span className="font-mono text-[#C5D2E6]">{currentTime}</span>
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
    </div>
  );
}
