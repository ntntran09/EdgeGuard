const legacyVietnameseReplacements: ReadonlyArray<readonly [string, string]> = [
  ['Nguoi dung da bat chuong bao dong', 'Người dùng đã bật chuông báo động'],
  ['Nguoi dung da tat chuong bao dong', 'Người dùng đã tắt chuông báo động'],
  ['Nguoi dung mo cua tu xa qua Mini App', 'Người dùng mở cửa từ xa qua Mini App'],
  ['Nguoi dung khoa cua tu xa qua Mini App', 'Người dùng khóa cửa từ xa qua Mini App'],
  ['Mo cua thanh cong bang the', 'Mở cửa thành công bằng thẻ'],
  ['The RFID/NFC khong hop le', 'Thẻ RFID/NFC không hợp lệ'],
  ['Phat hien chuyen dong (cam bien)', 'Phát hiện chuyển động (cảm biến)'],
  ['Cua da duoc mo (cam bien)', 'Cửa đã được mở (cảm biến)'],
  ['Da cap nhat the RFID/NFC', 'Đã cập nhật thẻ RFID/NFC'],
  ['Da quet the RFID/NFC', 'Đã quét thẻ RFID/NFC'],
  ['Da them the RFID/NFC', 'Đã thêm thẻ RFID/NFC'],
  ['Da xoa the RFID/NFC', 'Đã xóa thẻ RFID/NFC'],
  ['Tu choi the RFID/NFC', 'Từ chối thẻ RFID/NFC'],
  ['AI inference:', 'Suy luận AI:'],
  ['Chua dat ten', 'Chưa đặt tên'],
];

/** Keeps historical rows readable after user-facing copy gained Vietnamese diacritics. */
export function restoreVietnameseDiacritics(value?: string | null) {
  if (!value) return value || '';

  let restored = value;
  for (const [legacy, localized] of legacyVietnameseReplacements) {
    restored = restored.replaceAll(legacy, localized);
  }

  // Older default RFID names used "The <UID>".
  return restored.replace(/^The (?=[0-9A-F]{8,14}$)/i, 'Thẻ ');
}
