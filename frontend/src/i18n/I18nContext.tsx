import { createContext, useContext, type ReactNode } from "react";
import { zhTW, type ZhTW } from "./zh-TW";

const I18nContext = createContext<ZhTW>(zhTW);

export function I18nProvider({ children }: { children: ReactNode }) {
  return <I18nContext.Provider value={zhTW}>{children}</I18nContext.Provider>;
}

export function useI18n(): ZhTW {
  return useContext(I18nContext);
}
