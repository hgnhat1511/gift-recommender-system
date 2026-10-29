export const money = (value) => new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND'}).format(Number(value)||0);
export const occasions = [['birthday','Sinh nhật'],['anniversary','Kỷ niệm'],['valentines','Ngày Valentine'],['graduation','Tốt nghiệp'],['promotion','Thăng chức'],['housewarming','Tân gia'],['thank-you','Cảm ơn']];
export const recipients = [['partner','Người yêu/bạn đời'],['wife','Vợ'],['husband','Chồng'],['friend','Bạn bè'],['mother','Mẹ'],['father','Bố'],['sister','Chị/em gái'],['brother','Anh/em trai'],['teacher','Thầy cô'],['colleague','Đồng nghiệp'],['manager','Quản lý'],['student','Học sinh/sinh viên'],['child','Trẻ em'],['coffee-lover','Người yêu cà phê']];
export const interests = [['flowers','Hoa'],['gardening','Làm vườn'],['plants','Cây cảnh'],['stationery','Văn phòng phẩm'],['home','Đồ dùng gia đình'],['fragrance','Nến và hương thơm'],['coffee','Cà phê'],['craft','Thủ công'],['art','Nghệ thuật'],['sweets','Bánh kẹo'],['outdoors','Du lịch ngoài trời'],['decor','Đồ trang trí']];
export const styles = [['minimal','Tối giản'],['romantic','Lãng mạn'],['pastel','Nhẹ nhàng (Pastel)'],['natural','Tự nhiên'],['handmade','Thủ công'],['classic','Cổ điển'],['sweet','Ngọt ngào'],['playful','Vui tươi']];
export const giftTypes = [['gift-box','Hộp quà'],['flowers','Hoa tươi & sáp'],['home','Đồ gia dụng'],['stationery','Văn phòng phẩm'],['food','Bánh kẹo'],['plant','Cây cảnh'],['accessory','Phụ kiện'],['daily-use','Vật dụng hàng ngày'],['card','Thiệp chúc mừng'],['kitchen','Dụng cụ nhà bếp']];

export function formatReasonLabel(reason) {
  if (!reason || typeof reason !== 'string') return '';
  const match = reason.match(/^(Đúng dịp|Phù hợp người nhận|Khớp sở thích|Đúng phong cách|Đúng loại quà)\s+(.+)$/);
  if (match) {
    const prefix = match[1];
    const key = match[2];
    let label = key;
    if (prefix === 'Đúng dịp') label = occasions.find((x) => x[0] === key)?.[1] || key;
    else if (prefix === 'Phù hợp người nhận') label = recipients.find((x) => x[0] === key)?.[1] || key;
    else if (prefix === 'Khớp sở thích') label = interests.find((x) => x[0] === key)?.[1] || key;
    else if (prefix === 'Đúng phong cách') label = styles.find((x) => x[0] === key)?.[1] || key;
    else if (prefix === 'Đúng loại quà') label = giftTypes.find((x) => x[0] === key)?.[1] || key;
    return `${prefix} ${label}`;
  }
  return reason;
}
