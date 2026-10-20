import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./i18n/I18nContext";
import { applyHisDocumentTheme, loadClinicAppearance } from "./lib/hisTheme";
import "@shoelace-style/shoelace/dist/themes/light.css";
import "./index.css";

void loadClinicAppearance().finally(() => {
  applyHisDocumentTheme();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </StrictMode>,
  );
});
