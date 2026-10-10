require('dotenv').config();
const pool = require('../config/db');

const catalog = [
    { category: 'Sinh nhật', products: [
        ['Hộp quà sinh nhật pastel', 'Hộp quà được phối màu dịu nhẹ, phù hợp gửi tặng bạn bè.', 289000, 18, 'https://images.unsplash.com/photo-1513201099705-a9746e1e201f?auto=format&fit=crop&w=800&q=85', ['birthday'], ['friend','sister','colleague'], ['stationery','decor'], 'pastel', 'gift-box', true],
        ['Bánh kem mini lời chúc', 'Bánh kem nhỏ trang trí theo chủ đề sinh nhật.', 195000, 12, 'https://images.unsplash.com/photo-1486427944299-d1955d23e34d?auto=format&fit=crop&w=800&q=85', ['birthday'], ['friend','partner','sister'], ['sweets'], 'sweet', 'food', true],
        ['Bó hoa đồng nội', 'Bó hoa tươi theo mùa với thiệp viết tay.', 345000, 9, 'https://images.unsplash.com/photo-1494972308805-463bc619d34e?auto=format&fit=crop&w=800&q=85', ['birthday','thank-you'], ['mother','friend','teacher'], ['flowers','gardening'], 'natural', 'flowers', false]
    ]},
    { category: 'Tình yêu', products: [
        ['Hộp quà yêu thương', 'Bộ quà tặng gồm nến thơm và thiệp chúc mừng.', 399000, 14, 'https://images.unsplash.com/photo-1513883049090-d0b7439799bf?auto=format&fit=crop&w=800&q=85', ['anniversary','valentines'], ['partner','wife','husband'], ['home','fragrance'], 'romantic', 'gift-box', true],
        ['Hoa hồng pastel', 'Bó hoa hồng tông pastel gói giấy kraft.', 429000, 8, 'https://images.unsplash.com/photo-1494972308805-463bc619d34e?auto=format&fit=crop&w=800&q=85', ['anniversary','valentines'], ['partner','wife','mother'], ['flowers'], 'romantic', 'flowers', true],
        ['Nến thơm thư giãn', 'Nến thơm hương gỗ nhẹ, dùng cho không gian nghỉ ngơi.', 159000, 24, 'https://images.unsplash.com/photo-1603006905003-be475563bc59?auto=format&fit=crop&w=800&q=85', ['housewarming','thank-you'], ['friend','partner','colleague'], ['home','fragrance'], 'minimal', 'home', false]
    ]},
    { category: 'Quà handmade', products: [
        ['Sổ tay bìa vải thủ công', 'Sổ tay đóng thủ công, giấy dày phù hợp viết và vẽ.', 179000, 22, 'https://images.unsplash.com/photo-1517842645767-c639042777db?auto=format&fit=crop&w=800&q=85', ['graduation','birthday'], ['student','friend','teacher'], ['stationery','art'], 'handmade', 'stationery', true],
        ['Thiệp nổi hoa giấy', 'Thiệp cắt giấy thủ công kèm phong bì.', 89000, 40, 'https://images.unsplash.com/photo-1512909006721-3d6018887383?auto=format&fit=crop&w=800&q=85', ['birthday','thank-you','graduation'], ['friend','teacher','mother'], ['craft','stationery'], 'handmade', 'card', false],
        ['Bộ móc khóa len', 'Móc khóa len đan tay, màu sắc có thể thay đổi theo lô.', 119000, 16, 'https://images.unsplash.com/photo-1452860606245-08befc0ff44b?auto=format&fit=crop&w=800&q=85', ['birthday','housewarming'], ['friend','child','sister'], ['craft'], 'playful', 'accessory', false]
    ]},
    { category: 'Quà văn phòng', products: [
        ['Bình giữ nhiệt tối giản', 'Bình giữ nhiệt dung tích 500ml, thiết kế tối giản.', 325000, 20, 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=800&q=85', ['promotion','thank-you'], ['colleague','manager','teacher'], ['coffee','outdoors'], 'minimal', 'daily-use', true],
        ['Bộ bút ký thanh lịch', 'Bộ bút ký trong hộp quà, phù hợp dịp chúc mừng.', 259000, 11, 'https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=800&q=85', ['promotion','graduation'], ['colleague','manager','teacher'], ['stationery'], 'classic', 'stationery', false],
        ['Cốc cà phê gốm', 'Cốc gốm thủ công dùng tại văn phòng hoặc ở nhà.', 149000, 19, 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=800&q=85', ['housewarming','thank-you'], ['colleague','friend','coffee-lover'], ['coffee','home'], 'minimal', 'kitchen', false]
    ]},
    { category: 'Hoa & cây', products: [
        ['Chậu sen đá để bàn', 'Chậu sen đá nhỏ gọn, dễ chăm sóc trong không gian sáng.', 129000, 15, 'https://images.unsplash.com/photo-1485955900006-10f4d324d411?auto=format&fit=crop&w=800&q=85', ['housewarming','birthday'], ['colleague','friend','mother'], ['gardening','plants'], 'natural', 'plant', true],
        ['Giỏ hoa chúc mừng', 'Giỏ hoa tươi trang nhã dùng trong dịp chúc mừng.', 590000, 6, 'https://images.unsplash.com/photo-1525310072745-f49212b5ac6d?auto=format&fit=crop&w=800&q=85', ['promotion','graduation'], ['teacher','manager','mother'], ['flowers','gardening'], 'classic', 'flowers', false]
    ]}
];

async function seed() {
    const connection = await pool.getConnection();
    try {
        for (const group of catalog) {
            const [existing] = await connection.execute('SELECT id FROM categories WHERE name = ? LIMIT 1', [group.category]);
            let categoryId = existing[0]?.id;
            if (!categoryId) {
                const [created] = await connection.execute('INSERT INTO categories (name, description) VALUES (?, ?)', [group.category, `Quà tặng thuộc danh mục ${group.category}.`]);
                categoryId = created.insertId;
            }
            for (const [name, description, price, stock, imageUrl, occasions, recipients, interests, style, type, featured] of group.products) {
                await connection.execute(
                    `INSERT INTO products (category_id,name,description,price,stock,image_url,status,occasion_tags,recipient_tags,interest_tags,style,gift_type,is_featured)
                     SELECT ?,?,?,?, ?,?,'ACTIVE',CAST(? AS JSON),CAST(? AS JSON),CAST(? AS JSON),?,?,?
                     WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = ? LIMIT 1)`,
                    [categoryId,name,description,price,stock,imageUrl,JSON.stringify(occasions),JSON.stringify(recipients),JSON.stringify(interests),style,type,featured,name]
                );
            }
        }
        const [counts] = await connection.query('SELECT (SELECT COUNT(*) FROM categories) categories, (SELECT COUNT(*) FROM products) products');
        console.log(`Demo catalog ready: ${counts[0].categories} categories, ${counts[0].products} products.`);
    } finally {
        connection.release();
        await pool.end();
    }
}

seed().catch((error) => { console.error('Demo catalog seed failed:', error.code || 'unexpected error'); process.exitCode = 1; });
