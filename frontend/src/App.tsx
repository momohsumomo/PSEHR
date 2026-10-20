import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { LobbyPage } from "@/pages/LobbyPage";
import { PatientListPage } from "@/pages/PatientListPage";
import { LoginPage } from "@/pages/LoginPage";
import { RegisterPage } from "@/pages/RegisterPage";
import { ClinicOutpatientPage } from "@/pages/ClinicOutpatientPage";
import { DrugCatalogPage } from "@/pages/DrugCatalogPage";
import { CcTemplatesPage } from "@/pages/CcTemplatesPage";
import { DiagnosesDbPage } from "@/pages/DiagnosesDbPage";
import { UsageCatalogPage } from "@/pages/UsageCatalogPage";
import { DrugPackagesPage } from "@/pages/DrugPackagesPage";
import { ClaimsPage } from "@/pages/ClaimsPage";
import { BillingPage } from "@/pages/BillingPage";
import { EmrLookupPage } from "@/pages/EmrLookupPage";
import { ClinicProfilePage } from "@/pages/ClinicProfilePage";
import { StaffPage } from "@/pages/StaffPage";
import { DbRebuildPage } from "@/pages/DbRebuildPage";
import { BackupPage } from "@/pages/BackupPage";
import { DrugControlPage } from "@/pages/DrugControlPage";
import { UploadManagerPage } from "@/pages/UploadManagerPage";
import { SpeakerPage } from "@/pages/SpeakerPage";
import { ImgManagerPage } from "@/pages/ImgManagerPage";
import { ReferralPage } from "@/pages/ReferralPage";
import { PreventiveCarePage } from "@/pages/PreventiveCarePage";
import { PatientPreVisitPage } from "@/pages/PatientPreVisitPage";
import { IntakeKioskPage } from "@/pages/IntakeKioskPage";
import { SelfRegisterKioskPage } from "@/pages/SelfRegisterKioskPage";
import { applyHisDocumentTheme } from "@/lib/hisTheme";
import { PrintPreviewHost } from "@/components/clinic/PrintPreviewDialog";
import { DeskExeNotice } from "@/components/clinic/DeskExeNotice";

function AppShell() {
  return (
    <Routes>
      <Route path="/" element={<LobbyPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/patients" element={<PatientListPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/clinic" element={<ClinicOutpatientPage />} />
      <Route path="/drugs" element={<DrugCatalogPage />} />
      <Route path="/cc-templates" element={<CcTemplatesPage />} />
      <Route path="/diagnoses-db" element={<DiagnosesDbPage />} />
      <Route path="/usages" element={<UsageCatalogPage />} />
      <Route path="/packages" element={<DrugPackagesPage />} />
      <Route path="/claims" element={<ClaimsPage />} />
      <Route path="/billing" element={<BillingPage />} />
      <Route path="/emr-lookup" element={<EmrLookupPage />} />
      <Route path="/clinic-profile" element={<ClinicProfilePage />} />
      <Route path="/staff" element={<StaffPage />} />
      <Route path="/db-rebuild" element={<DbRebuildPage />} />
      <Route path="/backup" element={<BackupPage />} />
      <Route path="/drug-control" element={<DrugControlPage />} />
      <Route path="/upload-manager" element={<UploadManagerPage />} />
      <Route path="/speaker" element={<SpeakerPage />} />
      <Route path="/img-manager" element={<ImgManagerPage />} />
      <Route path="/referral" element={<ReferralPage />} />
      <Route path="/preventive-care" element={<PreventiveCarePage />} />
      <Route path="/previsit/:encounterId" element={<PatientPreVisitPage />} />
      <Route path="/kiosk/intake" element={<IntakeKioskPage />} />
      <Route path="/kiosk/register" element={<SelfRegisterKioskPage />} />
    </Routes>
  );
}

export default function App() {
  useEffect(() => {
    applyHisDocumentTheme();
    let machineId = localStorage.getItem("machine_id");
    if (!machineId) {
      const randHex = Math.random().toString(36).substring(2, 8).toUpperCase();
      machineId = `MC-ROOM-A-${randHex}`;
      localStorage.setItem("machine_id", machineId);
    }
  }, []);

  return (
    <BrowserRouter>
      <div className="wundadi-his min-h-screen" style={{ colorScheme: "only light" }}>
        <DeskExeNotice />
        <AppShell />
        <PrintPreviewHost />
      </div>
    </BrowserRouter>
  );
}

