import { useEffect, useRef, useState } from "react";
import { ensureMedblocksUi } from "@/lib/medblocks-setup";

type FhirResource = Record<string, unknown>;

interface Props {
  resource: FhirResource | null;
  hint: string;
  className?: string;
}

/**
 * 通用 mb-fhir-form 封裝（Patient、Encounter 等 FHIR 資源）。
 */
export function MedblocksFhirForm({ resource, hint, className }: Props) {
  const formRef = useRef<HTMLElement & { import?: (data: unknown) => void }>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureMedblocksUi()
      .then(() => setReady(true))
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!ready || !resource || !formRef.current?.import) return;
    try {
      formRef.current.import(resource);
    } catch {
      /* 版本差異時由外層 Tailwind 摘要補足 */
    }
  }, [ready, resource]);

  if (error) {
    return (
      <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        Medblocks UI 載入失敗：{error}
      </div>
    );
  }

  if (!ready) {
    return <div className="text-sm text-slate-500">載入 Medblocks UI…</div>;
  }

  return (
    <div className={className}>
      <p className="mb-2 text-xs font-medium text-slate-500">{hint}</p>
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <mb-fhir-form ref={formRef as never} plugin="fhir" novalidate />
      </div>
    </div>
  );
}
