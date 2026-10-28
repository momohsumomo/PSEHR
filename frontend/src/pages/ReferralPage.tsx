import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  deleteReferralSlip,
  fetchReferralDownloads,
  fetchReferralSlips,
  pullReferralNow,
  saveReferralSlip,
  uploadReferralSlip,
  type ReferralSlipRow,
} from "@/api/clinicApi";
import { ReferralReplyForm } from "@/components/clinic/ReferralReplyForm";
import { ReferralSlipDialog, type ReferralSeed } from "@/components/clinic/ReferralSlipDialog";
import { useClinicWorkspace } from "@/hooks/useClinicWorkspace";
import { useEscLayer } from "@/hooks/useEscLayer";
import { readLocalClinicBundle } from "@/lib/clinicProfile";
import { HIS, HIS_FONT } from "@/lib/hisTheme";
import type { QueueEntry } from "@/mocks/clinicMocks";

type Mode = "out" | "reply" | "down";

const OUT_PURPOSE: Array<[string, string]> = [
  ["1", "\u6025\u8a3a\u6cbb\u7642"],
  ["2", "\u4f4f\u9662\u6cbb\u7642"],
  ["3", "\u9580\u8a3a\u6cbb\u7642"],
  ["4", "\u9032\u4e00\u6b65\u6aa2\u67e5"],
  ["5", "\u8f49\u56de\u8f49\u51fa\u6216\u9069\u7576\u4e4b\u9662\u6240\u7e7c\u7e8c"],
  ["6", "\u5176\u4ed6\u76ee\u7684"],
];

const NHI_DEPT: Record<string, string> = {
  "00": "\u4e0d\u5206\u79d1",
  "01": "\u5bb6\u91ab\u79d1",
  "02": "\u5167\u79d1",
  "03": "\u5916\u79d1",
  "04": "\u5c0f\u5152\u79d1",
  "05": "\u5a66\u7522\u79d1",
  "06": "\u9aa8\u79d1",
  "07": "\u795e\u7d93\u5916\u79d1",
  "08": "\u6ccc\u5c3f\u79d1",
  "09": "\u8033\u9f3b\u5589\u79d1",
  "10": "\u773c\u79d1",
  "11": "\u76ae\u819a\u79d1",
  "12": "\u795e\u7d93\u79d1",
  "13": "\u7cbe\u795e\u79d1",
  "14": "\u5fa9\u5065\u79d1",
  "15": "\u6574\u578b\u5916\u79d1",
  "16": "\u8077\u696d\u91ab\u5b78\u79d1",
  "22": "\u6025\u8a3a\u91ab\u5b78\u79d1",
  "2A": "\u7d50\u6838\u79d1",
  "2B": "\u6d17\u814e\u79d1",
  "40": "\u7259\u79d1",
  AA: "\u6d88\u5316\u5167\u79d1",
  AB: "\u5fc3\u81df\u8840\u7ba1\u5167\u79d1",
  AC: "\u80f8\u8154\u5167\u79d1",
  AD: "\u814e\u81df\u5167\u79d1",
  AE: "\u98a8\u6fd5\u514d\u75ab\u79d1",
  AF: "\u8840\u6db2\u816b\u7624\u79d1",
  AG: "\u5167\u5206\u6ccc\u79d1",
  AH: "\u611f\u67d3\u79d1",
  BA: "\u76f4\u8178\u5916\u79d1",
  BB: "\u5fc3\u81df\u8840\u7ba1\u5916\u79d1",
  BC: "\u80f8\u8154\u5916\u79d1",
  BD: "\u6d88\u5316\u5916\u79d1",
  CA: "\u5c0f\u5152\u5916\u79d1",
  CB: "\u65b0\u751f\u5152\u79d1",
  DA: "\u75bc\u75db\u79d1",
  EA: "\u5c45\u5bb6\u8b77\u7406",
};

function deptLabel(code: string | undefined): string {
  const key = (code || "").trim();
  if (!key) return "\u2014";
  const name = NHI_DEPT[key];
  return name ? `${key} ${name}` : key;
}

function purposeOn(raw: string | undefined, code: string): boolean {
  const text = (raw || "").trim();
  if (text.length >= 5 && /[YN]/.test(text)) {
    const index = "12345".indexOf(code);
    return index >= 0 && text[index] === "Y";
  }
  return text === code;
}

function rocDay(iso: string | undefined): string {
  const day = (iso || "").slice(0, 10);
  const parts = day.split("-");
  if (parts.length !== 3) return "";
  const year = Number(parts[0]);
  if (!year) return "";
  return `${year - 1911}.${parts[1]}.${parts[2]}`;
}

export function ReferralPage() {
  const navigate = useNavigate();
  const { queue } = useClinicWorkspace();
  const [mode, setMode] = useState<Mode>("out");
  const [items, setItems] = useState<ReferralSlipRow[]>([]);
  const [picked, setPicked] = useState("");
  const [filter, setFilter] = useState("");
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const [showToday, setShowToday] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [slipOpen, setSlipOpen] = useState(false);

  useEscLayer([{ open: true, close: () => navigate("/") }]);

  const load = useCallback(async (kind: Mode) => {
    const data = kind === "down" ? await fetchReferralDownloads() : await fetchReferralSlips(kind);
    setItems(data.items || []);
  }, []);

  useEffect(() => {
    setPicked("");
    setSlipOpen(false);
    setNote("");
    void load(mode).catch((err: unknown) => {
      setNote(err instanceof Error ? err.message : "\u540d\u55ae\u8b80\u4e0d\u5230");
    });
  }, [mode, load]);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return items.filter((row) => {
      const day = (row.openedOn || "").slice(0, 10);
      if (fromDay && day && day < fromDay) return false;
      if (toDay && day && day > toDay) return false;
      if (fromDay && !day) return false;
      if (toDay && !day) return false;
      if (!needle) return true;
      return [row.patientName, row.medicalNo, row.destHosp, row.serial, row.status, row.openedOn]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [items, filter, fromDay, toDay]);

  const acceptedWithoutReply = (status: string) => {
    const text = status || "";
    return text.includes("\u5df2\u53d7\u7406") && !text.includes("\u5df2\u56de\u5fa9") && !text.includes("\u5df2\u56de\u8986");
  };
  const downQuiet = mode === "down" ? shown.filter((row) => acceptedWithoutReply(row.status || "")) : [];
  const downOpen = mode === "down" ? shown.filter((row) => !acceptedWithoutReply(row.status || "")) : shown;

  const current = items.find((row) => row.id === picked) || null;
  const today = useMemo(() => {
    const seen = new Set<string>();
    return queue.filter((row) => {
      if (!row.encounterId || seen.has(row.encounterId)) return false;
      seen.add(row.encounterId);
      return true;
    });
  }, [queue]);

  const addToday = async (row: QueueEntry) => {
    if (mode === "down") return;
    setBusy(true);
    setNote("");
    try {
      const saved = await saveReferralSlip({
        kind: mode,
        encounterId: row.encounterId,
        patientName: row.patientDisplay || "",
        medicalNo: row.medicalNo || "",
        idNo: row.idNo || "",
        doctor: row.doctorName || "",
        diagnosis: row.diseaseName || "",
        note: row.reasonText || "",
        status: mode === "out" ? "\u8349\u7a3f" : "\u5f85\u67e5",
      });
      await load(mode);
      setPicked(saved.id);
      setSlipOpen(mode === "out");
    } catch (err: unknown) {
      setNote(err instanceof Error ? err.message : "\u52a0\u5165\u540d\u55ae\u5931\u6557");
    } finally {
      setBusy(false);
    }
  };

  const archived = Boolean(current?.id.startsWith("ys-out-"));
  const seed: ReferralSeed = {
    name: current?.patientName || "",
    sex: current?.sex || "",
    birthday: current?.birth || "",
    medicalNo: current?.medicalNo || "",
    idNo: current?.idNo || "",
    phone: current?.phone || "",
    address: current?.address || "",
    chief: current?.note || "",
    diagnoses: current?.diagnosis || "",
    meds: current?.treatText || "",
    doctorName: current?.doctor || "",
    allergy: current?.allergyText || "",
    exam: current?.historyText || "",
    examOn: archived ? current?.examOn || "" : undefined,
    medOn: archived ? current?.medOn || "" : undefined,
  };
  const slipArchive = useMemo(() => {
    if (!current || mode !== "out" || !current.destHosp) return null;
    return {
      destHosp: current.destHosp,
      destCode: current.destCode,
      destAddr: current.destAddr || "",
      destTel: current.destTel || "",
      destDeptLabel: deptLabel(current.destDept),
      ourDept: (current.dept || "").trim(),
      clinicTel: current.clinicTel || "",
      fax: current.fax || "",
      email: current.email || "",
      validUntil: current.validUntil || "",
      purpose: current.purpose || "",
      suggestDoctor: current.destDoctor || "",
      openedOn: current.openedOn || "",
    };
  }, [current, mode]);

  const tab = (id: Mode, label: string) => (
    <button
      type="button"
      className="border px-3 py-1 text-[13px] font-bold"
      style={{
        borderColor: "#808080",
        background: mode === id ? "#FFF2A8" : "#D4D0C8",
      }}
      onClick={() => setMode(id)}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-screen flex-col" style={{ fontFamily: HIS_FONT, background: HIS.chrome }}>
      <div className="flex items-center gap-2 border-b bg-[#2060A0] px-2 py-1 text-xs font-bold text-white">
        <span>{"\u96fb\u5b50\u8f49\u8a3a"}</span>
        <button type="button" className="ml-auto border border-white/40 px-2" onClick={() => navigate("/")}>
          {"\u56de\u5927\u5ef3"}
        </button>
      </div>
      <div className="flex items-center gap-2 border-b bg-[#E8E4DC] px-2 py-1" style={{ borderColor: "#808080" }}>
        {tab("out", "\u8f49\u51fa")}
        {tab("reply", "\u56de\u8986")}
        {tab("down", "\u4e0b\u8f09")}
        <button
          type="button"
          className="border border-[#808080] bg-[#C8F0C8] px-2 py-1 text-[13px] font-bold"
          disabled={busy || mode === "down" || !current}
          onClick={() => {
            if (!current) return;
            void (async () => {
              setBusy(true);
              setNote("");
              try {
                const text = await uploadReferralSlip(current.id, mode === "reply" ? "\u5df2\u56de\u8986" : "\u5df2\u4e0a\u50b3");
                setNote(text);
                await load(mode);
              } catch (err: unknown) {
                setNote(err instanceof Error ? err.message : "\u4e0a\u50b3\u5931\u6557");
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          {"\u4e0a\u50b3\u9019\u4e00\u7b46"}
        </button>
        <button
          type="button"
          className="border border-[#808080] bg-[#F0C8C8] px-2 py-1 text-[13px] font-bold"
          disabled={busy || mode === "down" || !current}
          onClick={() => {
            if (!current) return;
            void (async () => {
              setBusy(true);
              setNote("");
              try {
                const text = await deleteReferralSlip(current.id);
                setNote(text);
                setPicked("");
                await load(mode);
              } catch (err: unknown) {
                setNote(err instanceof Error ? err.message : "\u4e0d\u80fd\u522a\u9664");
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          {"\u522a\u9664\u9019\u4e00\u7b46"}
        </button>
        <button
          type="button"
          className="border border-[#808080] bg-[#D4D0C8] px-2 py-1 text-[13px] font-bold"
          disabled={busy}
          onClick={() => {
            void (async () => {
              setBusy(true);
              setNote("");
              try {
                const text = await pullReferralNow();
                setNote(text);
                if (mode === "down") await load("down");
              } catch (err: unknown) {
                setNote(err instanceof Error ? err.message : "\u4e0b\u8f09\u5931\u6557");
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          {"\u73fe\u5728\u4e0b\u8f09"}
        </button>
        <span className="text-[12px]">
          {mode === "out"
            ? "\u9084\u6c92\u9001\u51fa\u7684\uff0c\u9000\u639b\u6642\u4e00\u4f75\u522a\u3002\u4e0a\u50b3\u672a\u6eff\u4e00\u5c0f\u6642\u53ef\u4ee5\u522a\u9664\u958b\u7acb\u3002\u8d85\u904e\u5c31\u7559\u8457\u3002"
            : mode === "reply"
              ? "\u7576\u5929\u9000\u639b\u53ef\u4ee5\u522a\u9664\u9019\u7b46\u56de\u5fa9\u3002\u4e0d\u662f\u7576\u5929\u7684\u5c31\u7559\u8457\u3002"
              : "\u6bcf\u5929 07:10 \u4e0b\u8f09\u4e00\u6b21\u3002\u73fe\u5728\u4e0b\u8f09\u662f\u984d\u5916\u518d\u505a\u3002\u53d6\u56de\u4ee5\u5f8c\u5c0d\u9f4a\u8f49\u51fa\u8207\u8f49\u5165\uff0c\u4e0d\u62ff\u4f86\u6c7a\u5b9a\u80fd\u4e0d\u80fd\u522a\u3002"}
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col border-r bg-white" style={{ borderColor: "#808080" }}>
          <div className="flex items-center border-b px-2 py-1 text-[12px] font-bold" style={{ borderColor: "#808080" }}>
            <span>
              {mode === "out" ? `\u8f49\u51fa\u540d\u55ae\uff08${shown.length}\uff09` : mode === "reply" ? `\u56de\u8986\u540d\u55ae\uff08${shown.length}\uff09` : `\u4e0b\u8f09\u540d\u55ae\uff08${shown.length}\uff09`}
            </span>
            {mode === "reply" ? (
              <button
                type="button"
                className="ml-auto border border-[#808080] bg-[#D4D0C8] px-1 font-bold"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    try {
                      const saved = await saveReferralSlip({ kind: "reply", status: "\u624b\u586b" });
                      await load("reply");
                      setPicked(saved.id);
                    } catch (err: unknown) {
                      setNote(err instanceof Error ? err.message : "\u65b0\u589e\u5931\u6557");
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                {"\u624b\u586b\u4e00\u7b46"}
              </button>
            ) : null}
          </div>
          <input
            className="m-1 border px-1 text-[12px]"
            style={{ borderColor: "#808080" }}
            value={filter}
            placeholder={"\u7be9\u59d3\u540d\u3001\u75c5\u6b77\u865f\u3001\u9662\u6240\u3001\u5e8f\u865f"}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="flex gap-1 px-1 pb-1 text-[11px]">
            <label className="flex items-center gap-1">{"\u8d77"}
              <input type="date" className="border px-0.5" style={{ borderColor: "#808080" }} value={fromDay} onChange={(e) => setFromDay(e.target.value)} />
            </label>
            <label className="flex items-center gap-1">{"\u8fc4"}
              <input type="date" className="border px-0.5" style={{ borderColor: "#808080" }} value={toDay} onChange={(e) => setToDay(e.target.value)} />
            </label>
          </div>
          <ul className="min-h-0 flex-1 overflow-auto text-[12px]">
            {downOpen.length === 0 && downQuiet.length === 0 ? (
              <li className="px-2 py-2 text-[#606060]">{"\u9019\u6bb5\u6c92\u6709\u5b58\u6a94\u3002\u62ff\u6389\u65e5\u671f\u5c31\u662f\u5168\u90e8\u7d00\u9304\u3002"}</li>
            ) : (
              <>
              {downOpen.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="block w-full px-2 py-1 text-left"
                    style={{ background: row.id === picked ? "#FFF2A8" : "transparent" }}
                    onClick={() => {
                      setPicked(row.id);
                      setSlipOpen(false);
                    }}
                    onDoubleClick={() => {
                      setPicked(row.id);
                      if (mode === "out") setSlipOpen(true);
                    }}
                  >
                    <div className="font-bold">{rocDay(row.openedOn)} {row.patientName || "\u2014"} {row.medicalNo}</div>
                    <div className="text-[11px] text-[#404040]">
                      {row.status || "\u2014"}
                      {row.destHosp ? ` \u00b7 ${row.destHosp}` : ""}
                      {row.serial ? ` \u00b7 ${row.serial}` : ""}
                    </div>
                  </button>
                </li>
              ))}
              {mode === "down" && downQuiet.length > 0 ? (
                <li className="border-t bg-[#F4F1EA] px-2 py-1 text-[12px] font-bold" style={{ borderColor: "#808080" }}>
                  {`\u5df2\u53d7\u7406\u672a\u56de\u8986\uff08${downQuiet.length}\uff09`}
                </li>
              ) : null}
              {downQuiet.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="block w-full px-2 py-1 text-left"
                    style={{ background: row.id === picked ? "#FFF2A8" : "transparent" }}
                    onClick={() => {
                      setPicked(row.id);
                      setSlipOpen(false);
                    }}
                  >
                    <div className="font-bold">{rocDay(row.openedOn)} {row.patientName || "\u2014"} {row.medicalNo}</div>
                    <div className="text-[11px] text-[#404040]">
                      {row.status || "\u2014"}
                      {row.destHosp ? ` \u00b7 ${row.destHosp}` : ""}
                      {row.serial ? ` \u00b7 ${row.serial}` : ""}
                    </div>
                  </button>
                </li>
              ))}
              </>
            )}
          </ul>
          {mode === "down" ? null : (
          <div className="border-t" style={{ borderColor: "#808080" }}>
            <button
              type="button"
              className="w-full bg-[#E8E4DC] px-2 py-1 text-left text-[12px] font-bold"
              onClick={() => setShowToday((open) => !open)}
            >
              {showToday ? "\u6536\u8d77\u4eca\u65e5\u770b\u8a3a" : "\u5f9e\u4eca\u65e5\u770b\u8a3a\u65b0\u958b\u4e00\u7b46"}
            </button>
            {showToday && today.length === 0 ? (
              <p className="px-2 py-1 text-[12px]">{"\u4eca\u5929\u6e05\u55ae\u6c92\u6709\u4eba\u3002"}</p>
            ) : null}
            {showToday && today.length > 0 ? (
              <div className="max-h-40 overflow-auto">
              {today.map((row) => (
                <button
                  key={row.encounterId}
                  type="button"
                  disabled={busy}
                  className="block w-full px-2 py-0.5 text-left text-[12px] hover:bg-[#FFF8D0]"
                  onClick={() => void addToday(row)}
                >
                  {row.queueNumber} {row.patientDisplay} {row.medicalNo || ""}
                </button>
              ))}
              </div>
            ) : null}
          </div>
          )}
        </aside>
        <section className="min-w-0 flex-1 overflow-auto bg-[#F4F1EA] p-3 text-[13px]">
          {!current ? (
            <p>{"\u8acb\u5148\u5f9e\u5de6\u908a\u9078\u4e00\u4f4d\u3002\u9019\u88e1\u4e0d\u6703\u81ea\u52d5\u5e36\u51fa\u7b2c\u4e00\u500b\u4eba\u3002"}</p>
          ) : mode === "down" ? (
            <DownloadSheet current={current} />
          ) : mode === "out" ? (
            <OutSlipSheet current={current} onOpen={() => setSlipOpen(true)} />
          ) : (
            <ReferralReplyForm
              row={current}
              onNote={setNote}
              onSaved={() => void load("reply")}
              onClose={() => setPicked("")}
            />
          )}
          {note ? <p className="mt-3 max-w-xl text-[13px] text-[#004000]">{note}</p> : null}
        </section>
      </div>
      <ReferralSlipDialog
        open={slipOpen && mode === "out" && Boolean(current)}
        encounterId={current?.encounterId || ""}
        slipId={current?.id}
        archive={slipArchive}
        seed={seed}
        onClose={() => {
          setSlipOpen(false);
          void load("out");
        }}
        onSaved={() => void load("out")}
      />
    </div>
  );
}

function DownloadSheet({ current }: { current: ReferralSlipRow }) {
  const line = "border border-black p-2 align-top";
  return (
    <div className="max-w-3xl border bg-white p-3" style={{ borderColor: "#000" }}>
      <div className="mb-2 text-[16px] font-bold">{current.status || "\u8f49\u8a3a"}</div>
      <table className="w-full border-collapse text-[13px]">
        <tbody>
          <tr>
            <td className={line}>{"\u59d3\u540d "}{current.patientName || "\u2014"}</td>
            <td className={line}>{"\u75c5\u6b77\u865f "}{current.medicalNo || "\u2014"}</td>
            <td className={line}>{"\u8eab\u5206\u8b49 "}{current.idNo || "\u2014"}</td>
          </tr>
          <tr>
            <td className={line} colSpan={2}>{"\u9662\u6240 "}{current.destHosp || "\u2014"} {current.destCode}</td>
            <td className={line}>{"\u958b\u55ae "}{rocDay(current.openedOn) || current.openedOn || "\u2014"}</td>
          </tr>
          <tr>
            <td className={line} colSpan={2}>{"\u5e8f\u865f "}{current.serial || "\u2014"}</td>
            <td className={line}>{"\u6709\u6548\u671f\u9650 "}{current.validUntil || "\u2014"}</td>
          </tr>
          <tr>
            <td className={line} colSpan={3}>
              <div className="whitespace-pre-wrap">{current.note || "\u2014"}</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function OutSlipSheet({ current, onOpen }: { current: ReferralSlipRow; onOpen: () => void }) {
  const clinic = readLocalClinicBundle().profile;
  const box = "border border-black p-1 align-top";
  return (
    <div className="max-w-4xl border bg-white p-2" style={{ borderColor: "#000" }}>
      <div className="text-center text-[16px] font-bold">{"\u5168\u6c11\u5065\u5eb7\u4fdd\u96aa\u3000\u9662(\u6240)\u8f49\u8a3a\u55ae"}</div>
      <div className="mb-1 text-center text-[13px]">
        {"\u8f49\u8a3a\u81f3 "}{current.destHosp || "\u3000\u3000"}{" \u9662\u6240"}
        {current.destCode ? ` ${current.destCode}` : ""}
      </div>
      <div className="mb-1 text-[12px]">
        {current.patientName} {current.medicalNo}
        {"\u3000\u72c0\u614b\uff1a"}{current.status || "\u8349\u7a3f"}
        {"\u3000\u958b\u55ae\u65e5\uff1a"}{rocDay(current.openedOn) || current.openedOn || "\u2014"}
        {current.serial ? `\u3000\u5e8f\u865f\uff1a${current.serial}` : ""}
      </div>
      <table className="w-full border-collapse text-[12px]">
        <tbody>
          <tr>
            <td className={box}>{"\u59d3\u540d "}{current.patientName || "\u2014"}</td>
            <td className={box}>{"\u6027\u5225 "}{current.sex || "\u2014"}</td>
            <td className={box}>{"\u51fa\u751f "}{current.birth || "\u2014"}</td>
            <td className={box}>{"\u8eab\u5206\u8b49\u865f "}{current.idNo || "\u2014"}</td>
          </tr>
          <tr>
            <td className={box}>{"\u806f\u7d61\u4eba "}{current.contact || "\u2014"}</td>
            <td className={box}>{"\u806f\u7d61\u96fb\u8a71 "}{current.phone || "\u2014"}</td>
            <td className={box} colSpan={2}>{"\u806f\u7d61\u5730\u5740 "}{current.address || "\u2014"}</td>
          </tr>
          <tr>
            <td className={box} colSpan={2}>
              <div className="font-bold">{"A. \u75c5\u60c5\u6458\u8981\uff08\u4e3b\u8a34\u53ca\u7c21\u77ed\u75c5\u53f2\uff09"}</div>
              <div className="mt-1 min-h-16 whitespace-pre-wrap">{current.note || "\u2014"}</div>
            </td>
            <td className={box} colSpan={2}>
              <div className="font-bold">{"D. \u85e5\u7269\u904e\u654f\u53f2"}</div>
              <div className="mt-1 min-h-16 whitespace-pre-wrap">{current.allergyText || "\u2014"}</div>
            </td>
          </tr>
          <tr>
            <td className={box} colSpan={4}>
              <div className="font-bold">{"B. \u8a3a\u65b7\u3000ICD-10-CM/PCS\u3000\u75c5\u540d"}</div>
              <div className="mt-1 min-h-12 whitespace-pre-wrap">{current.diagnosis || "\u2014"}</div>
            </td>
          </tr>
          <tr>
            <td className={box} colSpan={2}>
              <div className="font-bold">{"C. \u6aa2\u67e5\u53ca\u6cbb\u7642\u6458\u8981"}</div>
              <div className="mt-1">{"1. \u6700\u8fd1\u4e00\u6b21\u6aa2\u67e5\u7d50\u679c"}</div>
              <div>{"\u65e5\u671f\uff1a"}{current.examOn || "\u2014"}</div>
              <div className="min-h-12 whitespace-pre-wrap">{"\u5831\u544a\uff1a"}{current.historyText || "\u2014"}</div>
            </td>
            <td className={box} colSpan={2}>
              <div className="font-bold">{"2. \u6700\u8fd1\u4e00\u6b21\u7528\u85e5\u6216\u624b\u8853\u540d\u7a31"}</div>
              <div className="mt-1 min-h-16 whitespace-pre-wrap">{current.treatText || "\u2014"}</div>
              <div>{"\u65e5\u671f\uff1a"}{current.medOn || "\u2014"}</div>
            </td>
          </tr>
          <tr>
            <td className={box} colSpan={4}>
              <div className="font-bold">{"\u8f49\u8a3a\u76ee\u7684"}</div>
              {OUT_PURPOSE.map(([code, label]) => (
                <span key={code} className="mr-3 inline-block">
                  {purposeOn(current.purpose, code) ? "\u25a0" : "\u25a1"} {code}. {label}
                </span>
              ))}
              {current.purposeNote ? <div className="mt-1 whitespace-pre-wrap">{current.purposeNote}</div> : null}
            </td>
          </tr>
          <tr>
            <td className={box} colSpan={4}>
              {"\u8a3a\u7642\u91ab\u9662\u6240 "}{clinic.clinicName || "\u2014"}
              {"\u3000\u4f4f\u5740 "}{clinic.address || "\u2014"}
              <br />
              {"\u8a3a\u6cbb\u91ab\u5e2b "}{current.doctor || "\u2014"}
              {"\u3000\u79d1\u5225 "}{deptLabel(current.dept)}
              {"\u3000\u806f\u7d61\u96fb\u8a71 "}{current.clinicTel || clinic.phone || "\u2014"}
              {"\u3000\u50b3\u771f "}{current.fax || "\u2014"}
              {"\u3000\u96fb\u5b50\u4fe1\u7bb1 "}{current.email || "\u2014"}
              <br />
              {"\u4fdd\u96aa\u91ab\u4e8b\u670d\u52d9\u6a5f\u69cb\u4ee3\u865f\uff1a"}{clinic.clinicCode || "\u2014"}
            </td>
          </tr>
          <tr>
            <td className={box} colSpan={3}>
              {"\u5efa\u8b70\u8f49\u8a3a\u9662\u6240\u79d1\u5225\uff1a"}
              {"\u91ab\u9662 "}{current.destHosp || "\u2014"} {current.destCode}
              {"\u3000\u79d1\u5225 "}{deptLabel(current.destDept)}
              {"\u3000\u91ab\u5e2b "}{current.destDoctor || "\u2014"}
              <br />
              {"\u5730\u5740 "}{current.destAddr || "\u2014"}
              {"\u3000\u96fb\u8a71 "}{current.destTel || "\u2014"}
            </td>
            <td className={`${box} font-bold`}>
              {"\u6709\u6548\u671f\u9650"}
              <div>{current.validUntil || "\u2014"}</div>
            </td>
          </tr>
        </tbody>
      </table>
      <button
        type="button"
        className="mt-2 border border-[#808080] bg-[#C8F0C8] px-3 py-1 font-bold"
        onClick={onOpen}
      >
        {"\u958b\u9019\u4e00\u5f35\u8f49\u51fa\u55ae"}
      </button>
    </div>
  );
}
