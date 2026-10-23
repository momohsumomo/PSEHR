import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fetchIdCategorySettings, fetchPatient, updatePatient, type IdCategorySetting } from "@/api/clinicApi";
import { PatientMasterForm } from "@/components/clinic/PatientMasterForm";
import {
  emptyPatientRecord,
  fhirToPatientRecord,
  patientRecordToFhir,
  type PatientRecord,
} from "@/lib/patientMaster";
import { HIS, HIS_FONT } from "@/lib/hisTheme";

const SEX_M = "男";
const SEX_F = "女";
const ERR_LOAD = "載入病患失敗";
const ERR_SAVE = "存檔失敗";
const TITLE = "病患基本資料 ⇒ 修改模式";
const LOADING = "載入中…";
const SAVE = "存檔";
const SAVING = "存檔中…";
const CANCEL = "取消";


export type PatientEditSeed = {
  patientId: string;
  name?: string;
  idNo?: string;
  birthday?: string;
  sex?: string;
  phone?: string;
  phone2?: string;
  medicalNo?: string;
  address?: string;
  allergicMemo?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  seed: PatientEditSeed | null;
  onSaved?: () => void;
};

/** 診療／掛號底欄 F5：與大廳病患資料同一套 PatientMasterForm（大尺寸修改模式）。 */
export function PatientEditDialog({ open, onClose, seed, onSaved }: Props) {
  const [form, setForm] = useState<PatientRecord>(emptyPatientRecord());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idCategories, setIdCategories] = useState<IdCategorySetting[]>([]);

  useEffect(() => {
    if (!open) return;
    fetchIdCategorySettings()
      .then(setIdCategories)
      .catch(() => setIdCategories([]));
  }, [open]);

  const load = useCallback(async (s: PatientEditSeed) => {
    setLoading(true);
    setError(null);
    setForm(
      emptyPatientRecord({
        id: s.patientId,
        name: s.name || "",
        idNo: s.idNo || "",
        birthday: s.birthday || "",
        sex:
          s.sex === "F" || s.sex === SEX_F
            ? SEX_F
            : s.sex === "M" || s.sex === SEX_M
              ? SEX_M
              : s.sex || SEX_M,
        phone: s.phone || "",
        phone2: s.phone2 || "",
        medicalNo: s.medicalNo || "",
        address: s.address || "",
        allergicMemo: s.allergicMemo || "",
      }),
    );
    try {
      const p = await fetchPatient(s.patientId);
      setForm(fhirToPatientRecord(p));
    } catch (e) {
      setError(e instanceof Error ? e.message : ERR_LOAD);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !seed?.patientId) return;
    void load(seed);
  }, [open, seed, load]);

  if (!open) return null;

  const save = async () => {
    if (!form.id) return;
    setSaving(true);
    setError(null);
    try {
      let pin: string | undefined;
      const pinVal = sessionStorage.getItem("clinic_operator_pin");
      const pinTime = sessionStorage.getItem("clinic_operator_pin_time");
      if (pinVal && pinTime && Date.now() - parseInt(pinTime, 10) < 15 * 60 * 1000) {
        pin = pinVal;
      }
      await updatePatient(form.id, patientRecordToFhir(form), pin);
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : ERR_SAVE);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/45 p-2">
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

        {loading ? (
          <p className="p-4 text-sm text-[#004D00]">{LOADING}</p>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto" style={{ maxHeight: "calc(96vh - 6.5rem)" }}>
            <PatientMasterForm
              value={form}
              onChange={setForm}
              readOnly={false}
              showSpeak={false}
              className="!h-auto"
              idCategoryOptions={idCategories}
            />
          </div>
        )}

        {error ? (
          <p className="shrink-0 bg-red-100 px-3 py-1 text-sm text-red-900">{error}</p>
        ) : null}

        <footer className="flex shrink-0 items-center gap-2 border-t border-[#80C080] bg-[#D0F0D0] px-3 py-2">
          <button
            type="button"
            disabled={saving || loading || !form.id}
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
          <span className="ml-auto font-mono text-[12px] text-[#004D00]">
            {form.medicalNo || form.idNo || form.id}
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
