/** NHI cloud medication history. Opens the page only; login stays with the clinic PC. */
export const NHI_CLOUD_RX_URL = "https://medcloud.nhi.gov.tw/imme0008/IMME0008S01.aspx";

export function openNhiCloudRx(): void {
  window.open(NHI_CLOUD_RX_URL, "_blank", "noopener");
}
