import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchLoginOptions,
  getOAuthToken,
  request
} from "@/api/clinicApi";

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

export function LoginPage() {
  const navigate = useNavigate();
  const [patients, setPatients] = useState<any[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Load patient list to select from (for testing stateless/passkey login easily)
  useEffect(() => {
    const loadPatients = async () => {
      try {
        const data = await request<any[]>("/v1/Patient?_count=50");
        setPatients(data || []);
        if (data && data.length > 0) {
          setSelectedPatientId(data[0].id);
        }
      } catch (err) {
        console.error("Failed to load patient catalog", err);
      }
    };
    loadPatients();
  }, []);

  const handleFido2Login = async () => {
    if (!selectedPatientId) {
      setError("請先選擇要登入的患者帳號");
      return;
    }

    try {
      setLoading(true);
      setError("");
      setSuccess("");

      // 1. Fetch assertion options
      const options = await fetchLoginOptions(selectedPatientId);

      // Convert fields
      options.challenge = base64urlToBytes(options.challenge);
      if (options.allowCredentials) {
        for (const cred of options.allowCredentials) {
          cred.id = base64urlToBytes(cred.id);
        }
      }

      // 2. Call navigator.credentials.get()
      const assertion = (await navigator.credentials.get({
        publicKey: options
      })) as PublicKeyCredential;

      if (!assertion) {
        throw new Error("認證已取消或裝置無回應");
      }

      // 3. Serialize assertion response
      const response = assertion.response as AuthenticatorAssertionResponse;
      const assertionResponse = {
        id: assertion.id,
        rawId: bytesToBase64url(assertion.rawId),
        type: assertion.type,
        response: {
          clientDataJSON: bytesToBase64url(response.clientDataJSON),
          authenticatorData: bytesToBase64url(response.authenticatorData),
          signature: bytesToBase64url(response.signature),
          userHandle: response.userHandle ? bytesToBase64url(response.userHandle) : null
        }
      };

      // 4. Request OAuth access token
      const result = await getOAuthToken(selectedPatientId, assertionResponse);
      
      // Store in session storage
      sessionStorage.setItem("oauth_token", result.access_token);
      setSuccess("登入成功！正在跳轉...");
      
      setTimeout(() => {
        navigate("/");
      }, 1000);

    } catch (err: any) {
      console.error(err);
      setError(err.message || "FIDO2 驗證失敗");
    } finally {
      setLoading(false);
    }
  };

  const handleBypass = () => {
    // Clear oauth_token to use standard system permissions
    sessionStorage.removeItem("oauth_token");
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans select-none">
      
      {/* Background radial highlights */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-violet-600/10 blur-[150px] pointer-events-none" />

      {/* Login Card */}
      <div className="w-full max-w-md bg-slate-900/60 border border-slate-800/80 rounded-3xl p-8 backdrop-blur-md shadow-2xl flex flex-col gap-6 z-10">
        
        {/* Title / Logo */}
        <div className="text-center">
          <div className="text-4xl mb-3">🛡️</div>
          <h2 className="text-xl font-black text-slate-200 tracking-wider">Wundadi 門診</h2>
          <p className="text-xs text-slate-400 mt-1">SMART on FHIR & FIDO2 安全登入中心</p>
        </div>

        {error && (
          <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 p-3.5 rounded-2xl text-xs leading-relaxed font-bold">
            ⚠️ 錯誤：{error}
          </div>
        )}
        {success && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 p-3.5 rounded-2xl text-xs leading-relaxed font-bold">
            ✨ {success}
          </div>
        )}

        {/* User Selection */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-slate-400">選擇登入患者 (Patient)</label>
          <select
            value={selectedPatientId}
            onChange={(e) => setSelectedPatientId(e.target.value)}
            disabled={loading}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm font-bold text-slate-200 focus:outline-none focus:border-slate-700 disabled:opacity-50 transition"
          >
            {patients.length === 0 ? (
              <option value="">(無患者資料，請先以訪客登入新增)</option>
            ) : (
              patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.idNo || p.id.substring(0, 8)})
                </option>
              ))
            )}
          </select>
        </div>

        {/* Buttons */}
        <div className="flex flex-col gap-3">
          <button
            type="button"
            disabled={loading || !selectedPatientId}
            onClick={handleFido2Login}
            className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 disabled:active:scale-100 rounded-2xl text-sm font-black tracking-wide text-white shadow-lg shadow-emerald-950/20 transition duration-150 flex items-center justify-center gap-2"
          >
            <span>🔑</span>
            {loading ? "感應安全金鑰中..." : "FIDO2 密鑰安全登入"}
          </button>

          <div className="flex items-center gap-3 py-1 shrink-0 text-slate-600 text-xs">
            <div className="flex-1 h-px bg-slate-800" />
            <span>或</span>
            <div className="flex-1 h-px bg-slate-800" />
          </div>

          <button
            type="button"
            onClick={handleBypass}
            className="w-full py-3 px-4 bg-slate-800 hover:bg-slate-700 active:scale-95 rounded-2xl text-xs font-bold text-slate-300 transition"
          >
            跳過並進入系統 (訪客/系統權限)
          </button>
        </div>

      </div>

      {/* Footer Info */}
      <div className="mt-8 text-center text-[10px] text-slate-500 font-mono">
        <span>WebAuthn RP ID: localhost</span>
        <span className="mx-2">|</span>
        <span>Algorithm: ES256, RS256</span>
      </div>

    </div>
  );
}
