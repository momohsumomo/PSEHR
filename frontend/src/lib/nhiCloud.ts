/** NHI cloud medication history. Opens the page only; login stays with the clinic PC. */
export const NHI_CLOUD_RX_URL = "https://medcloud2.nhi.gov.tw/imu/imue1000?type=icc";

export function openNhiCloudRx(): void {
  window.open(NHI_CLOUD_RX_URL, "_blank", "noopener");
}
