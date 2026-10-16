import { useEffect, useState } from "react";
import { HIS_FONT } from "@/lib/hisTheme";
import { openPrintPreview } from "@/lib/printJob";
import { doctorDisplayName, pickClinicDoctor } from "@/lib/doctorName";
import { fetchStaff } from "@/api/clinicApi";
import { readLocalClinicBundle } from "@/lib/clinicProfile";

export type CertificateSeed = {
  patientDisplay?: string;
  idNo?: string;
  birthday?: string;
  sex?: string;
  age?: string;
  medicalNo?: string;
  address?: string;
  dept?: string;
  diagnosesText?: string;
  doctorName?: string;
  visitDate?: string;
};

type DocKind = "certificate" | "appointment" | "referral";

type Props = {
  open: boolean;
  onClose: () => void;
  seed?: CertificateSeed | null;
  onOpenReferral?: () => void;
};

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function show(v: string | undefined): string {
  const s = String(v ?? "").trim();
  return s || "\u2014";
}

export function CertificateDialog({ open, onClose, seed, onOpenReferral }: Props) {
  const [docNo, setDocNo] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [printDate, setPrintDate] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [order, setOrder] = useState("");
  const [kind, setKind] = useState<DocKind>("certificate");
  const [english, setEnglish] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [certTab, setCertTab] = useState<"a" | "b" | "c" | "d" | "e">("c");
  const [clinicDoctor, setClinicDoctor] = useState("");

  useEffect(() => {
    if (!open) return;
    const today = new Date();
    const roc = `${today.getFullYear() - 1911}.${String(today.getMonth() + 1).padStart(2, "0")}.${String(today.getDate()).padStart(2, "0")}`;
    setDocNo("");
    setVisitDate(seed?.visitDate || roc);
    setPrintDate(roc);
    setDiagnosis(seed?.diagnosesText || "");
    setOrder("");
    setKind("certificate");
    setEnglish(false);
    setNote(null);
    setCertTab("c");
    const named = doctorDisplayName(seed?.doctorName) || seed?.doctorName || "";
    let cancel = false;
    if (named) {
      setClinicDoctor(named);
    } else {
      void fetchStaff()
        .then((rows) => {
          if (cancel) return;
          const doc = pickClinicDoctor(rows);
          setClinicDoctor(doc ? doctorDisplayName(doc.name, doc.id) || doc.name : "");
        })
        .catch(() => undefined);
    }
    return () => {
      cancel = true;
    };
  }, [open, seed]);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const clinic = readLocalClinicBundle().profile;
  const name = seed?.patientDisplay || "";
  const sex = seed?.sex || "";
  const doctor = doctorDisplayName(seed?.doctorName) || seed?.doctorName || clinicDoctor;

  const printCertificate = () => {
    const en = english
      ? `<div style="text-align:center;font-size:12px;">Medical Certificate</div>`
      : "";
    const stamp =
      "\u672c\u8b49\u660e\u66f8\u9808\u52a0\u84cb\u672c\u9662\u6240\u5370\u7ae0\u5426\u5247\u7121\u6548\u25ce\ufe3b\u5175\u5f79\u8a34\u8a1f\u7121\u6548\ufe3c";
    const html = `<div style="font-family:'PMingLiU','Microsoft JhengHei',serif;font-size:13px;color:#000;line-height:1.35;">
      <div>\u91ab\u4e8b\u6a5f\u69cb\u4ee3\u865f\uff1a${esc(show(clinic.clinicCode))}</div>
      <div style="text-align:center;font-size:22px;font-weight:bold;margin-top:4px;">${esc(show(clinic.clinicName))}</div>
      <div style="text-align:center;font-size:18px;letter-spacing:0.35em;margin-top:2px;">\u8a3a\u3000\u65b7\u3000\u8b49\u3000\u660e\u3000\u66f8</div>
      ${en}
      <div style="text-align:right;margin:6px 0;">\u8a3a\u65b7\u6587\u865f\uff1a${esc(show(docNo))}</div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #000;">
        <tr>
          <td style="border:1px solid #000;padding:4px;">\u59d3\u540d ${esc(show(name))}</td>
          <td style="border:1px solid #000;padding:4px;">\u6027 \u5225 ${esc(show(sex))}</td>
          <td style="border:1px solid #000;padding:4px;">\u75c5\u6b77\u865f ${esc(show(seed?.medicalNo))}</td>
          <td rowspan="5" style="border:1px solid #000;width:28px;text-align:center;writing-mode:vertical-rl;letter-spacing:2px;">${stamp}</td>
        </tr>
        <tr>
          <td colspan="3" style="border:1px solid #000;padding:4px;">\u5e74\u9f61 ${esc(show(seed?.age))} \u51fa\u751f ${esc(show(seed?.birthday))} \u8eab\u5206\u8b49\u5b57\u865f ${esc(show(seed?.idNo))}</td>
        </tr>
        <tr>
          <td colspan="3" style="border:1px solid #000;padding:4px;">\u4f4f\u5740 ${esc(show(seed?.address))}</td>
        </tr>
        <tr>
          <td colspan="3" style="border:1px solid #000;padding:4px;">\u61c9\u8a3a\u65e5\u671f ${esc(show(visitDate))} \u79d1\u5225 ${esc(show(seed?.dept))}</td>
        </tr>
        <tr>
          <td colspan="3" style="border:1px solid #000;padding:6px;height:92mm;vertical-align:top;">
            <div style="font-weight:bold;">\u75c5\u540d</div>
            <div style="white-space:pre-wrap;min-height:28mm;">${esc(show(diagnosis))}</div>
            <div style="font-weight:bold;margin-top:6mm;">\u91ab\u5e2b\u56d1\u8a00</div>
            <div style="white-space:pre-wrap;">${esc(show(order))}</div>
          </td>
        </tr>
      </table>
      <div style="margin-top:8px;">\u4ee5\u4e0a\u75c5\u4eba\u7d93\u672c\u9662\u6240\u91ab\u5e2b\u8a3a\u65b7\u5c6c\u5be6\u7279\u4e88\u8b49\u660e</div>
      <div style="margin-top:8px;font-size:16px;">\u8a3a \u6cbb \u91ab \u5e2b\uff1a${esc(show(doctor))}</div>
      <div>\u91ab\u5e2b\u8b49\u66f8\u5b57\u865f\uff1a${esc(show(clinic.licenseNo))}</div>
      <div>\u5730\u5740\uff1a${esc(show(clinic.address))}</div>
      <div style="text-align:center;margin-top:10px;">\u4e2d \u83ef \u6c11 \u570d ${esc(show(printDate))}</div>
    </div>`;
    openPrintPreview({
      kind: "report",
      setupId: "certificate",
      title: "\u8a3a\u65b7\u8b49\u660e\u66f8",
      lines: [],
      bodyHtml: html,
    });
    setNote("\u5df2\u958b\u555f\u9810\u89bd\u3002\u78ba\u5b9a\u5f8c\u518d\u6309\u9810\u89bd\u4e0a\u7684\u5217\u5370\u3002");
  };

  const printAppointment = () => {
    const html = `<div style="font-family:'PMingLiU','Microsoft JhengHei',serif;font-size:14px;">
      <div style="text-align:center;font-size:20px;font-weight:bold;">${esc(show(clinic.clinicName))}</div>
      <div style="text-align:center;font-size:18px;margin:6px 0;">\u9810\u7d04\u55ae</div>
      <div>\u59d3\u540d ${esc(show(name))} \u75c5\u6b77\u865f ${esc(show(seed?.medicalNo))}</div>
      <div>\u5c31\u8a3a\u65e5 ${esc(show(visitDate))} \u5217\u5370\u65e5 ${esc(show(printDate))}</div>
      <div style="margin-top:8px;white-space:pre-wrap;">${esc(show(order))}</div>
      <div style="margin-top:16px;">\u91ab\u5e2b ${esc(show(doctor))}</div>
    </div>`;
    openPrintPreview({
      kind: "report",
      setupId: "certificate",
      title: "\u9810\u7d04\u55ae",
      lines: [],
      bodyHtml: html,
    });
    setNote("\u5df2\u958b\u555f\u9810\u89bd\u3002\u78ba\u5b9a\u5f8c\u518d\u6309\u9810\u89bd\u4e0a\u7684\u5217\u5370\u3002");
  };

  const onPrint = () => {
    if (kind === "referral") {
      onOpenReferral?.();
      return;
    }
    if (kind === "appointment") printAppointment();
    else printCertificate();
  };

  const btn = "border border-[#808080] bg-[#E8E8E8] px-2 py-1 text-[12px] font-bold";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/35 p-3">
      <div
        className="flex h-[min(88vh,760px)] w-[min(68rem,98vw)] flex-col border border-[#808080] bg-[#E8E8E8]"
        style={{ fontFamily: HIS_FONT }}
      >
        <div className="flex shrink-0 items-center bg-[#206868] px-2 py-1 text-[12px] font-bold text-white">
          <span>{"\u8a3a\u65b7\u8b49\u660e\u8207\u91ab\u56d1"}</span>
          <button type="button" className="ml-auto px-2" onClick={onClose}>Esc</button>
        </div>
        <div className="flex shrink-0 gap-0.5 border-b border-[#808080] bg-[#D4D0C8] px-1 pt-1">
          {(
            [
              ["a", "A \u904e\u654f\u85e5\u7269\u8207\u7279\u5225\u8a18\u8f09"],
              ["b", "B \u6aa2\u67e5\u5831\u544a"],
              ["c", "C \u8a3a\u65b7\u8b49\u660e\u8207\u91ab\u56d1"],
              ["d", "D \u63d0\u9192\u4e8b\u9805\u8207\u5e7c\u5152\u9810\u6ce8"],
              ["e", "E \u5b55\u5a66B\u809d\u7522\u6aa2"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="px-2 py-1 text-[11px] font-bold"
              style={{ background: certTab === id ? "#206868" : "#E8E4DC", color: certTab === id ? "#fff" : "#000" }}
              onClick={() => setCertTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {certTab !== "c" ? (
          <div className="flex-1 p-4 text-[13px]">{"\u9019\u5206\u9801\u4ecd\u7531\u8a3a\u7642\u756b\u9762\u7684\u904e\u654f\u3001\u6aa2\u67e5\u3001\u63d0\u9192\u8655\u7406\u3002\u8a3a\u65b7\u8b49\u660e\u8acb\u7559\u5728 C\u3002"}</div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-1 p-2">
            <div className="flex flex-wrap items-center gap-3 text-[13px] font-bold">
              <label>{"\u8a3a\u65b7\u6587\u865f"} <input className="w-36 border border-[#808080] bg-white px-1 font-normal" value={docNo} onChange={(e) => setDocNo(e.target.value)} /></label>
              <label>{"\u5c31\u8a3a\u65e5"} <input className="w-28 border border-[#808080] bg-white px-1 font-normal" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} /></label>
              <label>{"\u5217\u5370\u65e5"} <input className="w-28 border border-[#808080] bg-white px-1 font-normal" value={printDate} onChange={(e) => setPrintDate(e.target.value)} /></label>
              <span className="font-normal text-[#333]">{name} {seed?.medicalNo || ""}</span>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-2">
              <section className="flex min-h-0 flex-col">
                <div className="text-[13px] font-bold">{"\u8a3a\u65b7\u5167\u5bb9"}</div>
                <textarea
                  className="min-h-0 flex-1 border border-[#808080] bg-white p-1 text-[13px]"
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                />
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <button type="button" className={btn} onClick={onPrint}>{"\u5217\u5370\uff08\u8a2d\u5b9a\uff09"}</button>
                  <button type="button" className={btn} onClick={() => setDiagnosis(seed?.diagnosesText || diagnosis)}>{"T \u5f9e\u7576\u65e5\u75c5\u6b77\u8f49\u5165"}</button>
                  <label className="text-[12px] font-normal">
                    <input type="checkbox" checked={english} onChange={(e) => setEnglish(e.target.checked)} /> {"\u5217\u5370\u82f1\u6587\u683c\u5f0f\u8a3a\u65b7\u66f8"}
                  </label>
                </div>
              </section>
              <section className="flex min-h-0 flex-col">
                <div className="flex flex-wrap items-center gap-3 text-[13px] font-bold">
                  <span>{"\u91ab\u56d1\u5167\u5bb9"}</span>
                  {(
                    [
                      ["certificate", "\u8a3a\u65b7\u8b49\u660e\u66f8"],
                      ["appointment", "\u9810\u7d04\u55ae"],
                      ["referral", "\u8f49\u8a3a\u55ae"],
                    ] as const
                  ).map(([id, label]) => (
                    <label key={id} className="font-normal">
                      <input type="radio" checked={kind === id} onChange={() => setKind(id)} /> {label}
                    </label>
                  ))}
                </div>
                {kind === "referral" ? (
                  <div className="mt-1 flex flex-1 flex-col justify-center gap-2 border border-[#808080] bg-white p-3 text-[13px]">
                    <p>{"\u8f49\u8a3a\u55ae\u4e0d\u662f\u9019\u4e00\u683c\u91ab\u56d1\u3002\u6b04\u4f4d\u7167\u91ab\u8056\u8f49\u8a3a\u7cfb\u7d71\uff1a\u5de6\u908a\u4e3b\u8a34\u3001\u8a3a\u65b7\u3001\u7528\u85e5\uff0c\u53f3\u908a\u8f49\u8a3a\u76ee\u7684\u8207\u4e09\u806f\u3002"}</p>
                    <button type="button" className={btn + " self-start"} onClick={() => onOpenReferral?.()}>{"\u958b\u555f\u8f49\u8a3a\u55ae"}</button>
                  </div>
                ) : (
                  <textarea
                    className="mt-1 min-h-0 flex-1 border border-[#808080] bg-white p-1 text-[13px]"
                    value={order}
                    onChange={(e) => setOrder(e.target.value)}
                    placeholder={kind === "appointment" ? "\u9810\u7d04\u8aaa\u660e" : "\u91ab\u5e2b\u56d1\u8a00"}
                  />
                )}
              </section>
            </div>
            {note ? <p className="text-[12px] text-[#004000]">{note}</p> : null}
          </div>
        )}
      </div>
    </div>
  );
}
