import { useEffect, useMemo, useRef, useState } from "react";
import { saveQualityLab } from "@/api/clinicApi";
import { HIS_FONT } from "@/lib/hisTheme";
import type { RxLine } from "@/mocks/clinicMocks";

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
  category: _category,
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
  void _category;
  const line = form;
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
      const doctorName = people.find((person) => (person.id || person.name) === physician)?.name || physician;
      const reportOn = day ? `${day.y}${day.m}${day.d}` : "";
      await saveQualityLab({
        encounterId,
        orderCode: line.nhiCode,
        orderName: line.name || line.nhiCode,
        report,
        patientName,
        medicalNo: chartNo,
        birthday,
        doctor: doctorName,
        slipNo: slip,
        reportOn,
      });
      setNote("\u5df2\u5b58\u9032\u4e3b\u6a5f\u3002\u9019\u53f0\u4e0d\u4e0a\u50b3\u3002\u8acb\u5230\u6c92\u6709\u958b 6.0 \u7684\u96fb\u8166\uff0c\u958b\u555f 5.1.7 \u5f8c\u7528\u8ad6\u8cea\u4e0a\u50b3\u5de5\u5177\u9001\u51fa\u3002");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "\u6c92\u6709\u5b58\u9032\u4e3b\u6a5f\u3002");
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
                {busy ? "\u5b58\u6a94\u4e2d" : "\u5b58\u6a94"}
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
