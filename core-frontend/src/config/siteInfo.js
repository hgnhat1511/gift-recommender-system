/**
 * Giftly — Cấu hình thông tin doanh nghiệp & dữ kiện kinh doanh
 * Quy tắc: Không bịa đặt hotline, mã coupon, hoặc cam kết giao hàng khi chưa có nguồn thật từ DB/backend.
 * Các trường có giá trị rỗng sẽ khiến UI ẩn hoặc không hiển thị thông tin chưa xác thực.
 */
export const siteInfo = {
  // Hotline & Giờ làm việc: Chưa có cấu hình số hotline chính thức trong DB
  hotline: '',
  workingHours: '',

  // Khuyến mãi: Bảng coupons trong DB dev hiện tại rỗng ([]). Để trống, không hiển thị mã giả.
  promoCode: '',
  promoDiscountPercent: null,

  // Vận chuyển: Cấu hình chuẩn từ backend orderController (FREE_SHIPPING_MINIMUM = 500.000₫ cho STANDARD)
  freeShippingMinimum: 500000,
  freeShippingMethod: 'STANDARD',
  expressDeliveryHours: null, // Chưa có căn cứ giao 2H trong DB

  // Hỗ trợ: Không quảng cáo 24/7 khi chưa có thỏa thuận vận hành thực tế
  support247: false,

  // Kênh mạng xã hội: URL chính thức của cửa hàng Giftly
  socialLinks: {
    zalo: 'https://zalo.me/giftly',
    facebook: 'https://facebook.com/giftly.vn',
    instagram: 'https://instagram.com/giftly.vn',
    telegram: 'https://t.me/giftly_vn',
    x: 'https://x.com/giftly_vn',
  },
};

export default siteInfo;
