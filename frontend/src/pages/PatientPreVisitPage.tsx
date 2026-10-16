import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { isApiMode, submitPreVisit } from "@/api/clinicApi";

const SYMPTOM_OPTIONS = [
  { id: "itching", label: "搔癢" },
  { id: "scaling", label: "脫屑" },
  { id: "rash", label: "紅疹" },
  { id: "pigment", label: "色素" },
  { id: "pain", label: "疼痛" },
] as const;

/**
 * 病患端預診（沙盒 1 可 Mock 送出；API 模式寫入後端 Encounter）
 */
export function PatientPreVisitPage() {
  const { encounterId = "" } = useParams();
  const [cc, setCc] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [allergyHist, setAllergyHist] = useState<boolean | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggleTag = (id: string) => {
    setTags((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  const handleSubmit = async () => {
    if (!cc.trim()) {
      setError("請填寫主訴");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (isApiMode() && encounterId) {
        await submitPreVisit({
          encounterId,
          chiefComplaint: cc.trim(),
          symptomTags: tags,
          hasDrugAllergyHistory: allergyHist ?? undefined,
        });
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失敗");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-md rounded-xl bg-white p-8 shadow-lg">
        <h1 className="text-xl font-bold text-emerald-800">預診已完成</h1>
        <p className="mt-2 text-sm text-slate-600">
          醫師將在診間看到您的主訴。請依叫號進診。
        </p>
        <Link to="/" className="mt-6 inline-block text-sm text-violet-700 underline">
          返回診所端
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md rounded-xl bg-white p-6 shadow-lg">
      <h1 className="text-lg font-bold text-slate-900">就診前預診</h1>
      <p className="mt-1 text-xs text-slate-500">
        病患自主填寫 · Encounter {encounterId || "（Mock 模式無需 ID）"}
      </p>

      <label className="mt-4 block text-sm font-medium text-slate-700">主訴</label>
      <textarea
        className="mt-1 w-full rounded border border-slate-300 p-2 text-sm"
        rows={4}
        value={cc}
        onChange={(e) => setCc(e.target.value)}
        placeholder="請描述主要不適…"
      />

      <p className="mt-4 text-sm font-medium text-slate-700">症狀（可複選）</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {SYMPTOM_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => toggleTag(o.id)}
            className={`rounded-full px-3 py-1 text-xs ${
              tags.includes(o.id)
                ? "bg-violet-600 text-white"
                : "bg-slate-100 text-slate-700"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <p className="mt-4 text-sm font-medium text-slate-700">是否有藥物過敏史？</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className={`rounded px-3 py-1 text-xs ${allergyHist === true ? "bg-red-600 text-white" : "bg-slate-100"}`}
          onClick={() => setAllergyHist(true)}
        >
          有
        </button>
        <button
          type="button"
          className={`rounded px-3 py-1 text-xs ${allergyHist === false ? "bg-slate-600 text-white" : "bg-slate-100"}`}
          onClick={() => setAllergyHist(false)}
        >
          無
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <button
        type="button"
        disabled={submitting}
        onClick={handleSubmit}
        className="mt-6 w-full rounded-lg bg-violet-600 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {submitting ? "提交中…" : "送出預診"}
      </button>
    </div>
  );
}
