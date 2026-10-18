import { useEffect, useState } from "react";
import { useEscLayer } from "@/hooks/useEscLayer";
import { createPortal } from "react-dom";
import {
  createPatient,
  fetchIdCategorySettings,
  fetchNextMedicalNo,
  type IdCategorySetting,
} from "@/api/clinicApi";
import { PatientMasterForm } from "@/components/clinic/PatientMasterForm";
import { screenDeskId } from "@/lib/deskId";
import { HIS, HIS_FONT } from "@/lib/hisTheme";
import {
  emptyPatientRecord,
  fhirToPatientRecord,
  patientRecordToFhir,
  type PatientRecord,
} from "@/lib/patientMaster";
import { birthdayToStored, type PatientHit } from "@/lib/patientSearch";

type Props = {
  open: boolean;
  query: string;
  onClose: () => void;
  onCreated: (hit: PatientHit) => void;
};

const TITLE = "\u75c5\u60a3\u57fa\u672c\u8cc7\u6599 \u21d2 \u65b0\u589e\u6a21\u5f0f";
const SAVE = "\u5b58\u6a94";
const SAVING = "\u5b58\u6a94\u4e2d\u2026";
const CANCEL = "\u53d6\u6d88";

function seedFromQuery(query: string): Partial<PatientRecord> {
  const q = query.trim();
  if (!q) return {};
  const stored = birthdayToStored(q);
  if (/^\d{7}$/.test(stored)) {
    const month = Number(stored.slice(3, 5));
    const day = Number(stored.slice(5, 7));
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { birthday: stored };
  }
  if (/^[\u4e00-\u9fff]/.test(q)) return { name: q };
  if (/^\d{8,10}$/.test(q)) return { phone: q };
  if (/^[A-Za-z0-9]{4,20}$/.test(q)) return { idNo: q.toUpperCase() };
  return {};
}

export function NewPatientDialog({ open, query, onClose, onCreated }: Props) {
  const [form, setForm] = useState<PatientRecord>(emptyPatientRecord());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idCategories, setIdCategories] = useState<IdCategorySetting[]>([]);

  useEscLayer([{ open, close: onClose }]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(emptyPatientRecord(seedFromQuery(query)));
    fetchIdCategorySettings()
      .then(setIdCategories)
      .catch(() => setIdCategories([]));
    void fetchNextMedicalNo()
      .then((medicalNo) => {
        setForm((prev) => (prev.medicalNo.trim() ? prev : { ...prev, medicalNo }));
      })
      .catch(() => undefined);
  }, [open, query]);

  if (!open) return null;

  const save = async () => {
    const name = form.name.trim();
    if (!name) {
      setError("\u8acb\u586b\u59d3\u540d");
      return;
    }
    if (!/^\d{7}$/.test(form.birthday)) {
      setError("\u8acb\u586b\u6c11\u570b\u751f\u65e5");
      return;
    }
    let idNo = "";
    try {
      idNo = screenDeskId(form.idNo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "\u8b49\u865f\u4e0d\u5c0d");
      return;
    }
    const medicalNo = form.medicalNo.trim();
    if (!medicalNo) {
      setError("\u8acb\u586b\u75c5\u6b77\u865f");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = patientRecordToFhir({ ...form, name, idNo, medicalNo });
      delete payload.id;
      if (!idNo && Array.isArray(payload.identifier)) {
        payload.identifier = payload.identifier.filter(
          (item) => item && typeof item === "object" && String((item as { value?: string }).value || "").trim(),
        );
      }
      const created = await createPatient(payload);
      const record = fhirToPatientRecord(created);
      const sex = record.sex === "\u5973" ? "F" : "M";
      onCreated({
        id: record.id,
        name: record.name,
        idNo: record.idNo,
        birthdayRoc: record.birthday,
        birthDateIso: "",
        sex,
        medicalNo: record.medicalNo,
        phone: record.phone,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "\u5efa\u6a94\u5931\u6557");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[96] flex items-center justify-center bg-slate-900/45 p-2">
      <div
        className="flex max-h-[96vh] w-[min(64rem,98vw)] flex-col overflow-hidden border-2 shadow-xl"
        style={{
          borderColor: "#004D00",
          background: "#E8F8E8",
          fontFamily: HIS_FONT,
        }}
      >
        <header
          className="flex shrink-0 items-center justify-between px-3 py-1.5 font-bold text-white"
          style={{ background: "linear-gradient(90deg,#004D00,#108040)", fontSize: HIS.fs.primary }}
        >
          <span>{TITLE}</span>
          <button type="button" className="px-1" onClick={onClose}>
            {"\u2715"}
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          <PatientMasterForm
            value={form}
            onChange={setForm}
            readOnly={false}
            showSpeak={false}
            idCategoryOptions={idCategories}
          />
        </div>
        {error ? <p className="shrink-0 bg-red-100 px-3 py-1 text-sm text-red-900">{error}</p> : null}
        <footer className="flex shrink-0 items-center gap-2 border-t border-[#80C080] bg-[#D0F0D0] px-3 py-2">
          <button
            type="button"
            disabled={saving}
            className="rounded border border-[#004D00] bg-white px-4 py-1.5 text-[13px] font-bold text-[#004D00] disabled:opacity-40"
            onClick={() => void save()}
          >
            {saving ? SAVING : SAVE}
          </button>
          <button
            type="button"
            className="rounded border border-slate-500 bg-white px-4 py-1.5 text-[13px] font-semibold"
            onClick={onClose}
          >
            {CANCEL}
          </button>
          <span className="ml-auto font-mono text-[12px] text-[#004D00]">{form.medicalNo || form.idNo}</span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
