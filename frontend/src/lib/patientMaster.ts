import type { ApiPatient } from "@/api/clinicApi";

/** 病患主檔（對醫聖 USER／病患基本資料）。 */
export type PatientRecord = {
  id: string;
  name: string;
  idNo: string;
  birthday: string;
  sex: string;
  phone: string;
  phone2: string;
  address: string;
  address2: string;
  postalCode: string;
  medicalNo: string;
  kind: string;
  deposit: string;
  arrearage: string;
  bloodType: string;
  marry: string;
  allergicMemo: string;
  memo: string;
  customId: string;
  nhiCardNo: string;
  idCategory: string;
  /** 醫聖 USER.CPARTPAY：1 不要優待、2 全部優待、3 分級優待 */
  copayDisc: string;
  parentId: string;
  birthOrder: string;
  nursingHomeIn: string;
  nursingHomeOut: string;
  closeReason: string;
  medicalHistory: string;
  nursingHomeCode: string;
  contactName: string;
  contactPhone: string;
};

export function emptyPatientRecord(partial?: Partial<PatientRecord>): PatientRecord {
  return {
    id: "",
    name: "",
    idNo: "",
    birthday: "",
    sex: "男",
    phone: "",
    phone2: "",
    address: "",
    address2: "",
    postalCode: "",
    medicalNo: "",
    kind: "",
    deposit: "",
    arrearage: "",
    bloodType: "",
    marry: "",
    allergicMemo: "",
    memo: "",
    customId: "",
    nhiCardNo: "",
    idCategory: "",
    copayDisc: "1",
    parentId: "",
    birthOrder: "",
    nursingHomeIn: "",
    nursingHomeOut: "",
    closeReason: "",
    medicalHistory: "",
    nursingHomeCode: "",
    contactName: "",
    contactPhone: "",
    ...partial,
  };
}

export function fhirToPatientRecord(p: ApiPatient): PatientRecord {
  const family = p.name?.[0]?.family || "";
  const given = p.name?.[0]?.given?.join("") || "";
  const name = p.name?.[0]?.text || `${family}${given}` || "無姓名";
  const idNo =
    p.identifier?.find(
      (i) =>
        i.use === "official" ||
        !!i.system?.includes("moi.gov") ||
        !!i.system?.includes("nhidcc") ||
        !!i.system?.endsWith("/id") ||
        !!i.system?.includes("id-no"),
    )?.value ||
    p.identifier?.find(
      (i) =>
        i.use !== "secondary" &&
        !i.system?.includes("chart") &&
        !!i.value,
    )?.value ||
    p.identifier?.[0]?.value ||
    "";
  const medicalNo =
    p.identifier?.find(
      (i) =>
        i.use === "secondary" ||
        i.system?.includes("chart") ||
        i.system?.includes("chart-number"),
    )?.value || "";

  const sex = p.gender === "female" ? "女" : p.gender === "male" ? "男" : "其他";

  let birthday = "";
  const nhiBasic = p.extension?.find((e) => e.url?.includes("nhi-card-basic"));
  if (nhiBasic) {
    birthday = nhiBasic.extension?.find((sub) => sub.url === "birthdayRoc")?.valueString || "";
  }
  if (!birthday && p.birthDate) {
    const parts = p.birthDate.split("-");
    if (parts.length === 3) {
      birthday = String(parseInt(parts[0], 10) - 1911).padStart(3, "0") + parts[1] + parts[2];
    }
  }

  const phone = p.telecom?.find((t) => t.system === "phone" && t.use === "home")?.value || "";
  const phone2 = p.telecom?.find((t) => t.system === "phone" && t.use === "mobile")?.value || "";
  const address = p.address?.find((a) => a.use === "home" || !a.use)?.text || "";
  const address2 = p.address?.find((a) => a.use === "temp")?.text || "";

  let kind = "";
  let deposit = "";
  let arrearage = "";
  let memo = "";
  let bloodType = "";
  let marry = "";
  let allergicMemo = "";
  let customId = "";
  let nhiCardNo = "";
  let idCategory = "";
  let copayDisc = "1";
  let parentId = "";
  let birthOrder = "";
  let nursingHomeIn = "";
  let nursingHomeOut = "";
  let closeReason = "";
  let medicalHistory = "";
  let nursingHomeCode = "";
  let contactName = "";
  let contactPhone = "";

  const clinicExt = p.extension?.find((e) => e.url?.includes("patient-clinic-ext"));
  if (clinicExt) {
    const g = (url: string) => clinicExt.extension?.find((sub) => sub.url === url)?.valueString || "";
    kind = g("kind");
    deposit = g("keymoney");
    arrearage = g("arrearage");
    memo = g("memo");
    bloodType = g("blood");
    marry = g("marry");
    allergicMemo = g("allergic");
    customId = g("customId");
    nhiCardNo = g("nhiCardNo");
    idCategory = g("idCategory");
    copayDisc = g("copayDisc") || "1";
    parentId = g("parentId");
    birthOrder = g("birthOrder");
    nursingHomeIn = g("nursingHomeIn");
    nursingHomeOut = g("nursingHomeOut");
    closeReason = g("closeReason");
    medicalHistory = g("medicalHistory");
    nursingHomeCode = g("nursingHomeCode");
    contactName = g("contactName");
    contactPhone = g("contactPhone");
  }
  let postalCode = "";
  if (clinicExt) {
    postalCode =
      clinicExt.extension?.find((sub) => sub.url === "postalCode")?.valueString || "";
  }
  if (!postalCode) {
    postalCode = p.address?.find((a) => a.use === "home" || !a.use)?.postalCode || "";
  }

  return emptyPatientRecord({
    id: p.id || "",
    name,
    idNo,
    birthday,
    sex,
    phone,
    phone2,
    address,
    address2,
    postalCode,
    medicalNo,
    kind,
    deposit,
    arrearage,
    bloodType,
    marry,
    allergicMemo,
    memo,
    customId,
    nhiCardNo,
    idCategory,
    copayDisc,
    parentId,
    birthOrder,
    nursingHomeIn,
    nursingHomeOut,
    closeReason,
    medicalHistory,
    nursingHomeCode,
    contactName,
    contactPhone,
  });
}

export function patientRecordToFhir(record: PatientRecord): Record<string, unknown> {
  const name = record.name.trim();
  const family = name.charAt(0);
  const given = name.slice(1);

  let birthDate = "1911-01-01";
  if (record.birthday.length >= 7) {
    const rocYear = parseInt(record.birthday.slice(0, 3), 10);
    const month = record.birthday.slice(3, 5);
    const day = record.birthday.slice(5, 7);
    birthDate = `${rocYear + 1911}-${month}-${day}`;
  }

  const gender = record.sex === "女" ? "female" : record.sex === "男" ? "male" : "other";

  const identifier: Array<{ use: string; system: string; value: string }> = [
    { use: "official", system: "http://www.moi.gov.tw/id", value: record.idNo },
    { use: "official", system: "https://nhidcc.nhi.gov.tw/id", value: record.idNo },
  ];
  if (record.medicalNo) {
    identifier.push({
      use: "secondary",
      system: "https://clinic.org/chart-number",
      value: record.medicalNo,
    });
  }

  const telecom: Array<{ system: string; value: string; use: string }> = [];
  if (record.phone) telecom.push({ system: "phone", value: record.phone, use: "home" });
  if (record.phone2) telecom.push({ system: "phone", value: record.phone2, use: "mobile" });

  const address: Array<{ text: string; use: string; postalCode?: string }> = [];
  if (record.address) {
    address.push({
      text: record.address,
      use: "home",
      ...(record.postalCode ? { postalCode: record.postalCode } : {}),
    });
  }
  if (record.address2) address.push({ text: record.address2, use: "temp" });

  return {
    resourceType: "Patient",
    id: record.id,
    name: [{ family, given: [given], text: name }],
    gender,
    birthDate,
    identifier,
    telecom,
    address,
    extension: [
      {
        url: "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition/nhi-card-basic",
        extension: [
          { url: "idNo", valueString: record.idNo },
          { url: "birthdayRoc", valueString: record.birthday },
          { url: "sex", valueCode: record.sex === "女" ? "F" : "M" },
        ],
      },
      {
        url: "https://clinic.org/fhir/StructureDefinition/patient-clinic-ext",
        extension: [
          { url: "kind", valueString: record.kind },
          { url: "keymoney", valueString: record.deposit },
          { url: "arrearage", valueString: record.arrearage },
          { url: "memo", valueString: record.memo },
          { url: "blood", valueString: record.bloodType },
          { url: "marry", valueString: record.marry },
          { url: "allergic", valueString: record.allergicMemo },
          { url: "customId", valueString: record.customId },
          { url: "nhiCardNo", valueString: record.nhiCardNo },
          { url: "idCategory", valueString: record.idCategory },
          { url: "copayDisc", valueString: record.copayDisc || "1" },
          { url: "postalCode", valueString: record.postalCode },
          { url: "parentId", valueString: record.parentId },
          { url: "birthOrder", valueString: record.birthOrder },
          { url: "nursingHomeIn", valueString: record.nursingHomeIn },
          { url: "nursingHomeOut", valueString: record.nursingHomeOut },
          { url: "closeReason", valueString: record.closeReason },
          { url: "medicalHistory", valueString: record.medicalHistory },
          { url: "nursingHomeCode", valueString: record.nursingHomeCode },
          { url: "contactName", valueString: record.contactName },
          { url: "contactPhone", valueString: record.contactPhone },
        ],
      },
    ],
  };
}
