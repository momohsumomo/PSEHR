import { useState, useEffect } from "react";
import {
  fetchRegisterOptions,
  registerCredential,
  request
} from "@/api/clinicApi";

interface Fido2BindingModalProps {
  patientId: string;
  patientName: string;
  onClose: () => void;
}

function base64urlToBytes(base64url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function bytesToBase64url(bytes: ArrayBuffer): string {
  const array = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < array.length; i++) {
    binary += String.fromCharCode(array[i]);
  }
  const base64 = window.btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function Fido2BindingModal({
  patientId,
  patientName,
  onClose
}: Fido2BindingModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [existingKeys, setExistingKeys] = useState<any[]>([]);

  // Load existing FIDO2 keys of the patient from Patient FHIR resource
  const loadExistingKeys = async () => {
    try {
      setLoading(true);
      setError("");
      // Fetch Patient FHIR resource
      const patient = await request<any>(`/v1/Patient/${patientId}`);
      
      const FIDO2_KEY_EXTENSION_URL = "https://wundadi.tw/fhir/StructureDefinition/patient-fido2-key";
      const keys: any[] = [];
      if (patient.extension) {
        for (const ext of patient.extension) {
          if (ext.url === FIDO2_KEY_EXTENSION_URL) {
            let keyId = "";
            let counter = 0;
            for (const sub of ext.extension || []) {
              if (sub.url === "keyId") {
                keyId = sub.valueString;
              } else if (sub.url === "counter") {
                counter = sub.valueInteger || 0;
              }
            }
            if (keyId) {
              keys.push({ keyId, counter });
            }
          }
        }
      }
      setExistingKeys(keys);
    } catch (err: any) {
      setError("無法載入已綁定的安全密鑰: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExistingKeys();
  }, [patientId]);

  const handleRegister = async (attachment: "cross-platform" | "platform") => {
    try {
      setLoading(true);
      setError("");
      setSuccess("");

      // 1. Fetch options
      const options = await fetchRegisterOptions(patientId, attachment);
      
      // Convert challenge and user.id from base64url string to Uint8Array
      options.challenge = base64urlToBytes(options.challenge);
      options.user.id = base64urlToBytes(options.user.id);
      
      if (options.excludeCredentials) {
        for (const cred of options.excludeCredentials) {
          cred.id = base64urlToBytes(cred.id);
        }
      }

      // 2. Call WebAuthn API
      const credential = (await navigator.credentials.create({
        publicKey: options
      })) as PublicKeyCredential;

      if (!credential) {
        throw new Error("使用者取消或驗證器未回應");
      }

      // 3. Serialize response
      const response = credential.response as AuthenticatorAttestationResponse;
      const registrationResponse = {
        id: credential.id,
        rawId: bytesToBase64url(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: bytesToBase64url(response.clientDataJSON),
          attestationObject: bytesToBase64url(response.attestationObject),
          transports: response.getTransports ? response.getTransports() : []
        }
      };

      // 4. Send to backend
      const result = await registerCredential(patientId, registrationResponse);
      setSuccess(`密鑰綁定成功！ID: ${result.credentialId.substring(0, 10)}...`);
      await loadExistingKeys();
    } catch (err: any) {
      setError(err.message || "註冊密鑰時發生錯誤");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in p-4">
      <div className="bg-slate-900 border border-slate-700/60 w-full max-w-md rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] text-slate-100 font-sans">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-800/80 bg-slate-950/20 flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-bold text-base text-slate-200">FIDO2 安全憑證金鑰管理</h3>
            <p className="text-[10px] text-slate-400 mt-0.5">病患姓名: {patientName} (ID: {patientId})</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-lg transition p-1 hover:bg-slate-800/80 rounded"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto flex-1 flex flex-col gap-4 select-none scrollbar-thin">
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 p-3 rounded-lg text-xs leading-relaxed font-bold">
              ⚠️ 錯誤：{error}
            </div>
          )}
          {success && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 p-3 rounded-lg text-xs leading-relaxed font-bold">
              ✨ 成功：{success}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col gap-2 shrink-0">
            <span className="text-xs font-bold text-slate-300">新增安全驗證裝置</span>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={loading}
                onClick={() => handleRegister("cross-platform")}
                className="py-2.5 px-4 rounded-xl border border-sky-500/30 bg-sky-950/40 hover:bg-sky-900/40 disabled:opacity-50 text-xs font-bold text-sky-200 shadow-md flex flex-col items-center justify-center gap-1 active:scale-95 transition"
              >
                <span className="text-lg">🔑</span>
                <span>綁定 USB 金鑰/晶片卡</span>
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => handleRegister("platform")}
                className="py-2.5 px-4 rounded-xl border border-purple-500/30 bg-purple-950/40 hover:bg-purple-900/40 disabled:opacity-50 text-xs font-bold text-purple-200 shadow-md flex flex-col items-center justify-center gap-1 active:scale-95 transition"
              >
                <span className="text-lg">👤</span>
                <span>綁定本機指紋/刷臉</span>
              </button>
            </div>
          </div>

          {/* Existing Keys List */}
          <div className="flex-grow flex flex-col min-h-0">
            <span className="text-xs font-bold text-slate-300 mb-2 shrink-0">已綁定裝置 ({existingKeys.length})</span>
            {loading && existingKeys.length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-400 font-bold">讀取中...</div>
            ) : existingKeys.length === 0 ? (
              <div className="text-center py-8 border border-dashed border-slate-800 rounded-xl text-xs text-slate-500 font-bold bg-slate-950/10">
                尚未綁定任何 FIDO2 裝置
              </div>
            ) : (
              <div className="flex-grow overflow-y-auto border border-slate-800 bg-slate-950/20 rounded-xl divide-y divide-slate-800/80">
                {existingKeys.map((key, idx) => (
                  <div key={idx} className="p-3 flex items-center justify-between text-xs hover:bg-slate-800/20 transition">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-mono text-slate-300 font-bold">裝置 ID: {key.keyId.substring(0, 16)}...</span>
                      <span className="text-[10px] text-slate-400">計數器 (Counter): {key.counter}</span>
                    </div>
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-300 px-2 py-0.5 rounded-full font-bold border border-emerald-500/20">
                      安全可用
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800/80 bg-slate-950/20 flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs font-bold rounded-xl transition shadow-md"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
