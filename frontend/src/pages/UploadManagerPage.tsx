import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/** 舊網址改回主畫面的上傳子視窗。 */
export function UploadManagerPage() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/?open=ic", { replace: true });
  }, [navigate]);
  return null;
}
