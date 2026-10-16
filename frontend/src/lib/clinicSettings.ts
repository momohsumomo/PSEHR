const KEY = "wundadi-clinic-settings-v1";

export type ClinicSettings = {
  profile: {
    clinicGrade: string;
    region: string;
    clinicCode: string;
    clinicName: string;
    clinicNameEn: string;
    licenseNo: string;
    controlCertNo: string;
    mainDept: string;
    dispenseType: string;
    phone: string;
    zipCode: string;
    address: string;
    engAddress: string;
  };
  fees: {
    regFeeSelfPay: number;
    regFeeAdultCheckup: number;
    regFeeChildCare: number;
    regFeeCancerScreen: number;
    seniorAge: number;
  };
  drugControl: {
    countSelfPay: string;
    countDeliver: string;
    queryHost: string;
    queryPort: string;
    enableQuery: string;
    printerName: string;
    usageAddChartNo: string;
  };
};

export const DEFAULT_CLINIC_SETTINGS: ClinicSettings = {
  profile: {
    clinicGrade: "D 基層院所",
    region: "A 本島平地地區",
    clinicCode: "3521013662",
    clinicName: "璺到底皮膚專科診所",
    clinicNameEn: "WDD Dermatology Clinic",
    licenseNo: "南市衛診字第 3521013662 號",
    controlCertNo: "",
    mainDept: "11 皮膚科",
    dispenseType: "0 自行調劑",
    phone: "06-2882555",
    zipCode: "701",
    address: "台南市東區崇明路153-1號",
    engAddress: "No. 153-1, Chongming Rd., East Dist., Tainan City 701007, Taiwan",
  },
  fees: {
    regFeeSelfPay: 300,
    regFeeAdultCheckup: 0,
    regFeeChildCare: 0,
    regFeeCancerScreen: 0,
    seniorAge: 70,
  },
  drugControl: {
    countSelfPay: "Y",
    countDeliver: "N",
    queryHost: "10.253.253.243",
    queryPort: "7403",
    enableQuery: "Y",
    printerName: "預設印表機",
    usageAddChartNo: "N",
  },
};

export function loadClinicSettings(): ClinicSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_CLINIC_SETTINGS;
    return {
      ...DEFAULT_CLINIC_SETTINGS,
      ...JSON.parse(raw),
      profile: { ...DEFAULT_CLINIC_SETTINGS.profile, ...JSON.parse(raw).profile },
      fees: { ...DEFAULT_CLINIC_SETTINGS.fees, ...JSON.parse(raw).fees },
      drugControl: { ...DEFAULT_CLINIC_SETTINGS.drugControl, ...JSON.parse(raw).drugControl },
    };
  } catch {
    return DEFAULT_CLINIC_SETTINGS;
  }
}

export function saveClinicSettings(settings: ClinicSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
