import { useState } from "react";
import {
  CardReadError,
  readCardProfile,
  type CardProfile,
} from "@/api/clinicApi";
import { useEscLayer } from "@/hooks/useEscLayer";
import { HIS, HIS_FONT } from "@/lib/hisTheme";
import { formatBirthdayRoc } from "@/lib/patientSearch";

type Props = {
  open: boolean;
  onClose: () => void;
  treatSeq?: string;
  treatmentNumber?: string;
  treatDateTime?: string;
  cardNo?: string;
};

function show(value: string | undefined): string {
  const text = (value || "").trim();
  return text && text !== "—" ? text : "—";
}

function sexLabel(value: string | undefined): string {
  const text = (value || "").trim();
  if (text === "M" || text === "1" || text === "男") return "男";
  if (text === "F" || text === "2" || text === "女") return "女";
  return show(text);
}

/** F8／IC 資訊：先顯示這筆掛號已有的序號，讀卡只補卡面，不取號、不存檔。 */
export function IcCardInfoDialog({
  open,
  onClose,
  treatSeq,
  treatmentNumber,
  treatDateTime,
  cardNo,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<CardProfile | null>(null);

  useEscLayer([{ open, close: onClose }]);

  if (!open) return null;

  const read = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await readCardProfile();
      setProfile(res.profile || {});
    } catch (e) {
      setProfile(null);
      if (e instanceof CardReadError) {
        const extra = [e.diagnose?.deskTitle, e.diagnose?.humanActionLabel]
          .map((part) => (part || "").trim())
          .filter(Boolean);
        setError([e.message, ...extra].join("。"));
      } else {
        setError(e instanceof Error ? e.message : "讀卡失敗");
      }
    } finally {
      setBusy(false);
    }
  };

  const rows: Array<[string, string]> = [
    ["就醫序號", show(treatSeq)],
    ["就醫識別碼", show(treatmentNumber)],
    ["就醫時間", show(treatDateTime)],
    ["卡號", show(profile?.cardId || cardNo)],
    ["姓名", show(profile?.patientName)],
    ["身分證", show(profile?.idNo)],
    ["\u751f\u65e5", show(formatBirthdayRoc(profile?.birthday) || profile?.birthday)],
    ["性別", profile ? sexLabel(profile.sex) : "—"],
    ["卡片效期", "—"],
    ["重大傷病", "—"],
  ];

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4">
      <div
        className="w-[420px] border-2 bg-[#ECE9D8] shadow-lg"
        style={{ borderColor: HIS.titleBarBorder, fontFamily: HIS_FONT }}
      >
        <div
          className="flex items-center justify-between px-2 py-1 text-[13px] font-bold text-white"
          style={{ background: `linear-gradient(180deg, ${HIS.titleBarFrom}, ${HIS.titleBarTo})` }}
        >
          <span>這筆掛號的序號</span>
          <button type="button" className="px-1" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="px-3 py-2 text-[12px]">
          <p className="mb-2 text-[#404040]">
            這裡不是晶片裡的舊就醫紀錄，也不是雲端藥歷。上面四格是這筆掛號已經存下來的序號。按讀卡只讀健保卡卡面。讀卡機 6.0 讀不到卡片效期和重大傷病。
          </p>
          <table className="w-full border-collapse">
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label}>
                  <td className="w-24 py-0.5 font-bold text-[#003C74]">{label}</td>
                  <td className="py-0.5 font-mono" style={{ color: HIS.inputBlue }}>
                    {value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {error ? <p className="mt-2 font-bold text-[#800000]">{error}</p> : null}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              className="border px-3 py-1 font-bold"
              style={{ borderColor: HIS.chromeBorder, background: "#D4D0C8" }}
              disabled={busy}
              onClick={() => void read()}
            >
              {busy ? "讀卡中" : "讀卡"}
            </button>
            <button
              type="button"
              className="border px-3 py-1 font-bold"
              style={{ borderColor: HIS.chromeBorder, background: "#D4D0C8" }}
              onClick={onClose}
            >
              關閉
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
