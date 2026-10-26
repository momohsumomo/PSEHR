import { useEffect, useMemo, useRef, useState } from "react";
import { fetchDeskJob, uploadQualityLab } from "@/api/clinicApi";
import { HIS_FONT } from "@/lib/hisTheme";
import type { RxLine } from "@/mocks/clinicMocks";

function explain(detail: string): string {
  if (detail === "sent") return "\u5df2\u9001\u51fa\u3002\u7f72\u65b9\u9084\u8981\u518d\u6aa2\u6838\u3002";
  if (detail === "missing-cloud-dll") return "\u9019\u53f0\u627e\u4e0d\u5230\u96f2\u7aef\u7248\u4e0a\u50b3\u7a0b\u5f0f\uff0c\u6c92\u6709\u9001\u51fa\u3002";
  if (detail === "missing-powershell32") return "\u9019\u53f0\u6c92\u6709 32 \u4f4d\u5143 PowerShell\uff0c\u6c92\u6709\u9001\u51fa\u3002";
  if (detail === "bad-name") return "\u6a94\u540d\u4e0d\u5c0d\uff0c\u6c92\u6709\u9001\u51fa\u3002";
  if (detail === "no-code") return "\u4e0a\u50b3\u7a0b\u5f0f\u6c92\u6709\u56de\u4ee3\u78bc\u3002";
  if (detail === "timeout") return "\u4e0a\u50b3\u7b49\u592a\u4e45\uff0c\u6c92\u6709\u9001\u51fa\u3002";
  if (detail.startsWith("eii-")) return `\u4e0a\u50b3\u7a0b\u5f0f\u56de ${detail.slice(4)}\u3002`;
  return detail || "\u4e0a\u50b3\u6c92\u6709\u5b8c\u6210\u3002";
}

async function waitJob(id: string): Promise<string> {
  for (let i = 0; i < 40; i += 1) {
    const view = await fetchDeskJob(id);
    if (view.state === "done" || view.state === "error") return explain(view.detail || "");
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
  return "\u4e0a\u50b3\u7b49\u592a\u4e45\uff0c\u8acb\u7a0d\u5f8c\u518d\u770b\u9019\u53f0\u6709\u6c92\u6709\u9001\u51fa\u3002";
}

function rocParts(raw: string): { y: string; m: string; d: string } | null {
  const text = (raw || "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const y = Number(iso[1]) - 1911;
    if (y > 0) return { y: String(y).padStart(3, "0"), m: iso[2], d: iso[3] };
  }
  const digits = text.replace(/\D/g, "");
  if (digits.length >= 8 && Number(digits.slice(0, 4)) > 1911) {
    const y = Number(digits.slice(0, 4)) - 1911;
    if (y > 0) return { y: String(y).padStart(3, "0"), m: digits.slice(4, 6), d: digits.slice(6, 8) };
  }
  if (digits.length >= 7) {
    const year = Number(digits.slice(0, 3));
    const month = Number(digits.slice(3, 5));
    const date = Number(digits.slice(5, 7));
    if (year > 0 && year < 200 && month >= 1 && month <= 12 && date >= 1 && date <= 31) {
      return { y: String(year).padStart(3, "0"), m: digits.slice(3, 5), d: digits.slice(5, 7) };
    }
  }
  return null;
}

function nextSlip(when: string): string {
  const parts = rocParts(when) || rocParts(new Date().toISOString().slice(0, 10));
  const ym = parts ? `${parts.y}${parts.m}` : "00000";
  const key = `quality-lab-slip-${ym}`;
  let n = 1;
  try {
    n = Number(window.sessionStorage.getItem(key) || "0") + 1;
    if (!Number.isFinite(n) || n < 1) n = 1;
    if (n > 99999) n = 1;
    window.sessionStorage.setItem(key, String(n));
  } catch {
    n = 1;
  }
  return `${ym}${String(n).padStart(5, "0")}`;
}

export function QualityLabPanel({
  ask,
  form,
  encounterId,
  category,
  patientName,
  birthday,
  chartNo,
  when,
  doctors,
  doctorId,
  doctorName,
  onYes,
  onNo,
  onClose,
}: {
  ask: RxLine | null;
  form: RxLine | null;
  encounterId: string | null;
  category: string;
  patientName: string;
  birthday: string;
  chartNo: string;
  when: string;
  doctors: { id: string; name: string }[];
  doctorId: string;
  doctorName: string;
  onYes: () => void;
  onNo: () => void;
  onClose: () => void;
}) {
  const [report, setReport] = useState("");
  const [physician, setPhysician] = useState(doctorId || doctorName);
  const [slip, setSlip] = useState("");
  const [images, setImages] = useState<{ url: string; name: string }[]>([]);
  const [imageIdx, setImageIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const line = form;
  const narrativeKind = category === "2" || category === "3";
  const people = useMemo(() => {
    const rows = doctors.filter((person) => person.name.trim());
    const name = doctorName.trim();
    if (name && !rows.some((person) => person.id === doctorId || person.name === name)) {
      return [{ id: doctorId || name, name }, ...rows];
    }
    return rows;
  }, [doctors, doctorId, doctorName]);
  const born = rocParts(birthday);
  const day = rocParts(when);

  useEffect(() => {
    if (!form || slip) return;
    setSlip(nextSlip(when));
  }, [form, slip, when]);

  useEffect(() => {
    return () => {
      imagesRef.current.forEach((image) => URL.revokeObjectURL(image.url));
    };
  }, []);

  if (ask && !form) {
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35">
        <div className="w-[min(24rem,92vw)] border border-[#808080] bg-[#D4D0C8] shadow-lg" style={{ fontFamily: HIS_FONT }}>
          <div className="px-2 py-1 text-[13px] text-black">{"\u8ad6\u8cea\u6aa2\u9a57\u5831\u544a"}</div>
          <p className="bg-[#F0F0F0] px-3 py-4 text-[13px] leading-relaxed text-black">
            {`${ask.name || ask.nhiCode}\uff08${ask.nhiCode}\uff09\u8981\u586b\u5beb\u8ad6\u8cea\u6aa2\u9a57\u4e0a\u50b3\u55ce\uff1f`}
          </p>
          <div className="flex justify-end gap-1 px-2 py-2">
            <button type="button" className="border border-[#404040] bg-[#FFFF80] px-3 py-0.5 text-xs font-bold" onClick={onYes}>
              {"\u662f"}
            </button>
            <button type="button" className="border border-[#404040] bg-white px-3 py-0.5 text-xs font-bold" onClick={onNo}>
              {"\u5426"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!line || !encounterId) return null;
  const shown = images[imageIdx] || null;

  async function send() {
    if (!line || !encounterId || busy) return;
    setBusy(true);
    setNote("");
    try {
      const queued = await uploadQualityLab({
        encounterId,
        orderCode: line.nhiCode,
        orderName: line.name || line.nhiCode,
        result: narrativeKind ? "" : report,
        unit: "",
        refLow: "",
        refHigh: "",
        method: "",
        specimen: "",
        narrative: narrativeKind ? report : "",
      });
      setNote(await waitJob(queued.id));
    } catch (err) {
      setNote(err instanceof Error ? err.message : "\u4e0a\u50b3\u6c92\u6709\u5b8c\u6210\u3002");
    } finally {
      setBusy(false);
    }
  }

  function addImages(list: FileList | null) {
    const files = Array.from(list || []).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    const next = files.map((file) => ({ url: URL.createObjectURL(file), name: file.name }));
    setImageIdx(images.length);
    setImages((prev) => [...prev, ...next]);
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35">
      <div
        className="flex max-h-[92vh] w-[min(52rem,96vw)] flex-col border border-[#808080] bg-[#D4D0C8] shadow-lg"
        style={{ fontFamily: HIS_FONT }}
      >
        <div className="flex items-center justify-between px-2 py-0.5 text-[13px] text-black">
          <span>{"\u8ad6\u8cea\u6aa2\u9a57\u5831\u544a"}</span>
          <button type="button" className="px-2 text-sm" onClick={onClose} aria-label={"\u96e2\u958b"}>
            {"\u00d7"}
          </button>
        </div>
        <div className="m-1 flex min-h-0 flex-1 flex-col gap-2 border border-[#808080] bg-[#F0F0F0] p-2">
          <p className="text-center text-[15px] font-bold text-[#0000CC]">
            {`\u59d3\u540d\uff1a${patientName || "\u2014"}`}
            <span className="mx-4">{`\u751f\u65e5\uff1a${born ? `${Number(born.y)}.${born.m}.${born.d}` : "\u2014"}`}</span>
            {`\u75c5\u6b77\u865f\uff1a${chartNo || "\u2014"}`}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-black">
            <label>
              {"\u6aa2\u9a57\u55ae\u865f\uff1a"}
              <input className="ml-1 w-28 border border-[#808080] bg-[#E8E8E8] px-1" readOnly value={slip} />
            </label>
            <span>
              {"\u5831\u544a\u65e5\u671f\uff1a"}
              <span className="ml-1 inline-block border border-[#808080] bg-white px-1">
                {day ? (
                  <>
                    {`${Number(day.y)}.${day.m}.`}
                    <span className="text-[#CC0000]">{day.d}</span>
                  </>
                ) : (
                  "\u2014"
                )}
              </span>
            </span>
            <label>
              {"\u5831\u544a\u91ab\u5e2b\uff1a"}
              <select
                className="ml-1 border border-[#808080] bg-white px-1"
                value={physician}
                onChange={(e) => setPhysician(e.target.value)}
              >
                {people.length ? null : <option value="">{"\u2014"}</option>}
                {people.map((person) => (
                  <option key={person.id || person.name} value={person.id || person.name}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="text-[13px]">
            <span className="text-black">{"\u5831\u544a\u5167\u5bb9\uff1a"}</span>
            <span className="ml-4 text-[#008080]">
              {`\u5065\u4fdd\u78bc\uff1a${line.nhiCode}  \u6aa2\u9a57\u540d\u7a31\uff1a${line.nhiCode}^${line.name || line.nhiCode}`}
            </span>
          </div>
          <textarea
            className="h-36 w-full resize-none border border-[#7aa] bg-white px-1 text-[13px] text-black"
            value={report}
            onChange={(e) => setReport(e.target.value)}
          />
          <div className="flex min-h-40 gap-2">
            <div className="min-h-40 flex-1 overflow-hidden border border-[#808080] bg-white">
              {shown ? <img src={shown.url} alt={shown.name} className="h-full max-h-48 w-full object-contain" /> : null}
            </div>
            <div className="flex w-24 flex-col gap-2">
              <button
                type="button"
                className="border border-[#808080] bg-[#E8E8E8] px-1 py-2 text-xs"
                onClick={() => {
                  if (images.length > 1) setImageIdx((idx) => (idx + 1) % images.length);
                }}
              >
                {"\u5716\u50cf\u7ba1\u7406"}
              </button>
              <button
                type="button"
                className="border border-[#808080] bg-[#E8E8E8] px-1 py-2 text-xs"
                onClick={() => {
                  const current = images[imageIdx];
                  if (!current) return;
                  URL.revokeObjectURL(current.url);
                  const next = images.filter((_, idx) => idx !== imageIdx);
                  setImages(next);
                  setImageIdx((idx) => Math.max(0, Math.min(idx, next.length - 1)));
                }}
              >
                {"\u522a\u9664\u5f71\u50cf"}
              </button>
              <button
                type="button"
                className="border border-[#808080] bg-[#E8E8E8] px-1 py-2 text-xs"
                onClick={() => fileRef.current?.click()}
              >
                {"\u65b0\u589e\u5f71\u50cf"}
              </button>
              <button
                type="button"
                className="border border-[#808080] bg-[#E8E8E8] px-1 py-2 text-xs font-bold"
                disabled={busy || !report.trim()}
                onClick={() => void send()}
              >
                {busy ? "\u4e0a\u50b3\u4e2d" : "\u5b58\u6a94"}
              </button>
              <button type="button" className="border border-[#808080] bg-[#E8E8E8] px-1 py-2 text-xs" onClick={onClose}>
                {"\u96e2\u958b"}
              </button>
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              addImages(e.target.files);
              e.target.value = "";
            }}
          />
          {note ? <p className="text-[13px] text-black">{note}</p> : null}
        </div>
      </div>
    </div>
  );
}
