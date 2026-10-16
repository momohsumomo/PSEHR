import os
import json
from pathlib import Path
from typing import Any, Dict

class NiisAdapter:
    """
    疾管署 NIIS 預防接種上傳對接服務 (Adapter Pattern)。
    負責讀取對照檔與將門診疫苗施打數據轉譯、打包並虛擬上傳至疾病管制署 API。
    """
    def __init__(self, mapping_path: str | None = None) -> None:
        if mapping_path is None:
            mapping_path = str(Path(__file__).parent / "identity_mapping.json")
        self.mapping_path = mapping_path
        self.mapping = self._load_mapping()

    def _load_mapping(self) -> Dict[str, str]:
        if not os.path.exists(self.mapping_path):
            print(f"[Warning] NIIS Adapter: identity_mapping.json not found at {self.mapping_path}")
            return {}
        try:
            with open(self.mapping_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[Error] NIIS Adapter: Failed to load mapping: {e}")
            return {}

    def upload_vaccine_record(self, patient_data: Dict[str, Any], vaccine_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        將病患資料與疫苗施打明細打包為疾管署指定格式並發送上傳。
        """
        identity_code = patient_data.get("id_category", "C01D")
        cdc_category = self.mapping.get(identity_code, f"未對照身分別代碼 ({identity_code})")
        
        # 建立疾管署規格上傳 Payload
        niis_payload = {
            "OrgCode": "0421040011", # 阮綜合醫院
            "Patient": {
                "IdNo": patient_data.get("id_no"),
                "Name": patient_data.get("name"),
                "Birthday": patient_data.get("birthday_roc"),
                "Sex": patient_data.get("sex"),
            },
            "Vaccination": {
                "VaccineCode": vaccine_data.get("nhi_code"),
                "VaccineName": vaccine_data.get("drug_text"),
                "DoseNo": vaccine_data.get("dose_no", "1"),
                "BatchNo": vaccine_data.get("batch_no", "BATCH-DEFAULT-99"),
                "VaccDate": vaccine_data.get("vacc_date"),
                "IdentityCode": identity_code,
                "CdcCategoryDesc": cdc_category,
            }
        }
        
        # 模擬呼叫疾管署 API 的 HTTP 請求
        print(f"[NIIS Adapter] Uploading to CDC NIIS API: {json.dumps(niis_payload, ensure_ascii=False)}")
        
        return {
            "status": "success",
            "transaction_id": f"TX-NIIS-MOCK-{os.urandom(4).hex().upper()}",
            "uploaded_payload": niis_payload
        }
