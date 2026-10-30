import { useEffect, useState } from "react";
import { HIS_FONT } from "@/lib/hisTheme";
import { openPrintPreview } from "@/lib/printJob";
import { buildCertificateHtml } from "@/lib/clinicPrintDocs";
import { doctorDisplayName, pickClinicDoctor } from "@/lib/doctorName";
import { fetchStaff, fetchVisitCertificate, saveVisitCertificate } from "@/api/clinicApi";
import { readLocalClinicBundle } from "@/lib/clinicProfile";

export type CertificateSeed = {
  encounterId?: string;
  patientDisplay?: string;
  idNo?: string;
  birthday?: string;
  sex?: string;
  age?: string;
  medicalNo?: string;
  address?: string;
  dept?: string;
  diagnosesText?: string;
  diagnosesTextEn?: string;
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

const NO_VISIT =
  "\u9019\u4f4d\u75c5\u4eba\u9084\u6c92\u6709\u9019\u6b21\u770b\u8a3a\uff0c\u4e0d\u80fd\u5b58\u6a94\u3002\u5148\u639b\u865f\u6216\u9078\u5b9a\u4e00\u7b46\u770b\u8a3a\u3002";

function show(v: string | undefined): string {
  const s = String(v ?? "").trim();
  return s || "\u2014";
}

export function CertificateDialog({ open, onClose, seed, onOpenReferral }: Props) {
  const [docNo, setDocNo] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [printDate, setPrintDate] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [orderText, setOrderText] = useState("");
  const [appointmentText, setAppointmentText] = useState("");
  const [kind, setKind] = useState<DocKind>("certificate");
  const [english, setEnglish] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [certTab, setCertTab] = useState<"a" | "b" | "c" | "d" | "e">("c");
  const [clinicDoctor, setClinicDoctor] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [nextDocNo, setNextDocNo] = useState("");

  const encounterId = String(seed?.encounterId || "").trim();

  useEffect(() => {
    if (!open) return;
    const today = new Date();
    const roc = `${today.getFullYear() - 1911}.${String(today.getMonth() + 1).padStart(2, "0")}.${String(today.getDate()).padStart(2, "0")}`;
    setDocNo("");
    setVisitDate(seed?.visitDate || roc);
    setPrintDate(roc);
    setDiagnosis(seed?.diagnosesText || "");
    setOrderText("");
    setAppointmentText("");
    setKind("certificate");
    setEnglish(false);
    setNote(null);
    setSavedAt("");
    setNextDocNo("");
    setCertTab("c");
    const named = doctorDisplayName(seed?.doctorName) || seed?.doctorName || "";
    let cancel = false;
    if (encounterId) {
      void fetchVisitCertificate(encounterId)
        .then(({ certificate: row, nextDocNo: next }) => {
          if (cancel) return;
          setNextDocNo(next);
          if (!row) return;
          setDocNo(row.docNo || "");
          if (row.visitDate) setVisitDate(row.visitDate);
          if (row.printDate) setPrintDate(row.printDate);
          setDiagnosis(row.diagnosis || "");
          setOrderText(row.order || "");
          setAppointmentText(row.appointment || "");
          setEnglish(Boolean(row.english));
          setSavedAt(row.updatedAt || "");
          setNote("\u5df2\u5e36\u5165\u9019\u6b21\u770b\u8a3a\u5b58\u904e\u7684\u8a3a\u65b7\u66f8\u3002");
        })
        .catch((err: unknown) => {
          if (!cancel) setNote(err instanceof Error ? err.message : "\u8b80\u4e0d\u5230\u5b58\u904e\u7684\u8a3a\u65b7\u66f8\u3002");
        });
    }
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
  }, [open, seed, encounterId]);

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
  const order = kind === "appointment" ? appointmentText : orderText;
  const setOrder = (text: string) => {
    if (kind === "appointment") setAppointmentText(text);
    else setOrderText(text);
  };

  const saveNow = () =>
    saveVisitCertificate({
      encounterId,
      medicalNo: seed?.medicalNo || "",
      patientName: name,
      docNo,
      visitDate,
      printDate,
      diagnosis,
      order: orderText,
      appointment: appointmentText,
      doctor,
      english,
    }).then((row) => {
      if (row?.docNo) setDocNo(row.docNo);
      setSavedAt(row?.updatedAt || "");
      return row;
    });

  const onSave = () => {
    if (!encounterId) {
      setNote(NO_VISIT);
      return;
    }
    setSaving(true);
    setNote(null);
    void saveNow()
      .then(() => {
        setNote("\u5df2\u5b58\u6a94\u3002\u4e0b\u6b21\u6253\u958b\u9019\u6b21\u770b\u8a3a\u7684\u8a3a\u65b7\u66f8\u6703\u5e36\u56de\u9019\u4e9b\u5167\u5bb9\u3002");
      })
      .catch((err: unknown) => {
        setNote(err instanceof Error ? err.message : "\u5b58\u6a94\u5931\u6557\u3002");
      })
      .finally(() => setSaving(false));
  };

  const printCertificate = (number: string = docNo) => {
    const html = buildCertificateHtml({
      clinicCode: clinic.clinicCode,
      clinicName: clinic.clinicName,
      licenseNo: clinic.licenseNo,
      clinicAddress: clinic.address,
      docNo: number,
      name,
      sex,
      medicalNo: seed?.medicalNo || "",
      age: seed?.age || "",
      birthday: seed?.birthday || "",
      idNo: seed?.idNo || "",
      address: seed?.address || "",
      visitDate,
      dept: seed?.dept || "",
      diagnosis,
      order,
      doctor,
      printDate,
      english,
    });
    openPrintPreview({
      kind: "report",
      layout: "sheet",
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
      layout: "sheet",
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
    if (kind === "appointment") {
      printAppointment();
      return;
    }
    if (docNo.trim() || !encounterId) {
      printCertificate();
      return;
    }
    setSaving(true);
    setNote(null);
    void saveNow()
      .then((row) => printCertificate(row?.docNo || ""))
      .catch((err: unknown) => {
        setNote(err instanceof Error ? err.message : "\u5b58\u6a94\u5931\u6557\uff0c\u6c92\u6709\u53d6\u5f97\u6587\u865f\u3002");
      })
      .finally(() => setSaving(false));
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
              <label>{"\u8a3a\u65b7\u6587\u865f"} <input className="w-36 border border-[#808080] bg-white px-1 font-normal" value={docNo} placeholder={nextDocNo ? `\u4e0b\u4e00\u865f ${nextDocNo}` : ""} onChange={(e) => setDocNo(e.target.value)} /></label>
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
                  <button type="button" className={btn} disabled={saving} onClick={onSave}>
                    {saving ? "\u5b58\u6a94\u4e2d\u2026" : "\u5b58\u6a94"}
                  </button>
                  <button type="button" className={btn} onClick={onPrint}>{"\u5217\u5370\uff08\u8a2d\u5b9a\uff09"}</button>
                  <button type="button" className={btn} onClick={() => setDiagnosis((english ? seed?.diagnosesTextEn : seed?.diagnosesText) || diagnosis)}>{"T \u5f9e\u7576\u65e5\u75c5\u6b77\u8f49\u5165"}</button>
                  <label className="text-[12px] font-normal">
                    <input type="checkbox" checked={english} onChange={(e) => {
                      const on = e.target.checked;
                      setEnglish(on);
                      const zh = seed?.diagnosesText || "";
                      const en = seed?.diagnosesTextEn || "";
                      if (on && en && diagnosis === zh) setDiagnosis(en);
                      if (!on && zh && diagnosis === en) setDiagnosis(zh);
                    }} /> {"\u5217\u5370\u82f1\u6587\u683c\u5f0f\u8a3a\u65b7\u66f8"}
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
            {savedAt ? <p className="text-[11px] text-[#333]">{"\u4e0a\u6b21\u5b58\u6a94 " + savedAt}</p> : null}
          </div>
        )}
      </div>
    </div>
  );
}
