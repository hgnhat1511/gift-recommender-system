const pool = require('../config/db');
const {recommendProducts}=require('../services/recommendationService');

const present = (row) => row && ({
    id: String(row.id), categoryId: row.category_id == null ? null : String(row.category_id),
    category: row.category_name || null, name: row.name, description: row.description,
    price: Number(row.price), stock: Number(row.stock), imageUrl: row.image_url,
    status: row.status, occasionTags: row.occasion_tags || [], recipientTags: row.recipient_tags || [],
    interestTags: row.interest_tags || [], style: row.style, giftType: row.gift_type,
    isFeatured: Boolean(row.is_featured), averageRating: Number(row.average_rating || 0),
    reviewCount: Number(row.review_count || 0), createdAt: row.created_at
});

function getNumber(value, fallback) {
    if (value === undefined || value === '') return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

async function list(req, res, next) {
    try {
        const page = getNumber(req.query.page, 1);
        const limit = getNumber(req.query.limit, 12);
        const minPrice = getNumber(req.query.minPrice, null);
        const maxPrice = getNumber(req.query.maxPrice, null);
        if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100 ||
            (minPrice !== null && minPrice < 0) || (maxPrice !== null && maxPrice < 0) ||
            (minPrice !== null && maxPrice !== null && minPrice > maxPrice)) {
            return res.status(400).json({ success: false, message: 'Invalid pagination or price filter.' });
        }
        const where = ["p.status = 'ACTIVE'"];
        const params = [];
        if (req.query.q) {
            const q = String(req.query.q).trim().slice(0, 100).replace(/[\\%_]/g, '\\$&');
            where.push('(p.name LIKE ? ESCAPE \'\\\\\' OR p.description LIKE ? ESCAPE \'\\\\\' OR c.name LIKE ? ESCAPE \'\\\\\')');
            params.push(`%${q}%`, `%${q}%`, `%${q}%`);
        }
        if (req.query.category) { where.push('(c.id = ? OR c.name = ?)'); params.push(String(req.query.category), String(req.query.category)); }
        if (minPrice !== null) { where.push('p.price >= ?'); params.push(minPrice); }
        if (maxPrice !== null) { where.push('p.price <= ?'); params.push(maxPrice); }
        if (req.query.occasion) { where.push('JSON_CONTAINS(p.occasion_tags, JSON_QUOTE(?))'); params.push(String(req.query.occasion)); }
        if (req.query.recipient) { where.push('JSON_CONTAINS(p.recipient_tags, JSON_QUOTE(?))'); params.push(String(req.query.recipient)); }
        if (req.query.interest) { where.push('JSON_CONTAINS(p.interest_tags, JSON_QUOTE(?))'); params.push(String(req.query.interest)); }
        if (req.query.style) { where.push('p.style = ?'); params.push(String(req.query.style)); }
        if (req.query.giftType) { where.push('p.gift_type = ?'); params.push(String(req.query.giftType)); }
        if (req.query.inStock === 'true') where.push('p.stock > 0');
        if (req.query.featured === 'true') where.push('p.is_featured = 1');

        const orderBy = {
            newest: 'p.created_at DESC, p.id DESC', price_asc: 'p.price ASC, p.id DESC',
            price_desc: 'p.price DESC, p.id DESC', popular: 'p.is_featured DESC, COALESCE(ev.event_count, 0) DESC, p.id DESC',
            rating: 'COALESCE(rv.average_rating, 0) DESC, COALESCE(rv.review_count, 0) DESC, p.id DESC'
        }[req.query.sort] || 'p.is_featured DESC, p.created_at DESC, p.id DESC';
        const from = `FROM products p LEFT JOIN categories c ON c.id=p.category_id
            LEFT JOIN (SELECT product_id, AVG(rating) average_rating, COUNT(*) review_count FROM reviews WHERE is_approved=1 GROUP BY product_id) rv ON rv.product_id=p.id
            LEFT JOIN (SELECT product_id, COUNT(*) event_count FROM product_events WHERE event_type IN ('VIEW','CART_ADD','PURCHASE') AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) GROUP BY product_id) ev ON ev.product_id=p.id
            WHERE ${where.join(' AND ')}`;
        const [[countRow]] = await pool.execute(`SELECT COUNT(*) total ${from}`, params);
        const offset = (page - 1) * limit;
        const [rows] = await pool.execute(
            `SELECT p.*,c.name category_name,COALESCE(rv.average_rating,0) average_rating,COALESCE(rv.review_count,0) review_count ${from} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );
        return res.json({ success: true, data: { items: rows.map(present), pagination: { page, limit, total: Number(countRow.total), pages: Math.ceil(Number(countRow.total) / limit) } } });
    } catch (error) { return next(error); }
}

async function categories(req, res, next) {
    try {
        const [rows] = await pool.query(`SELECT c.id,c.name,c.description,COUNT(p.id) product_count
            FROM categories c LEFT JOIN products p ON p.category_id=c.id AND p.status='ACTIVE'
            WHERE c.is_active=1 GROUP BY c.id ORDER BY c.sort_order,c.name`);
        return res.json({ success: true, data: rows.map((row) => ({ id: String(row.id), name: row.name, description: row.description, productCount: Number(row.product_count) })) });
    } catch (error) { return next(error); }
}

async function lookup(req,res,next) {
    const raw = typeof req.query.ids === 'string' ? req.query.ids.split(',') : [];
    if (!raw.length || raw.length > 50 || raw.some((id) => !/^\d{1,20}$/.test(id)) || new Set(raw).size !== raw.length) {
        return res.status(400).json({ success:false,message:'Provide between 1 and 50 unique product ids.' });
    }
    try {
        const placeholders = raw.map(() => '?').join(',');
        const [rows] = await pool.execute(`SELECT p.*,c.name category_name,0 average_rating,0 review_count
            FROM products p LEFT JOIN categories c ON c.id=p.category_id
            WHERE p.id IN (${placeholders}) AND p.status='ACTIVE'`, raw);
        return res.json({ success:true,data:rows.map(present) });
    } catch (error) { return next(error); }
}

async function banners(req, res, next) {
    try {
        const [rows] = await pool.query(`SELECT id,title,subtitle,image_url,target_url,button_text,sort_order
            FROM homepage_banners
            WHERE is_active=1 AND (starts_at IS NULL OR starts_at<=UTC_TIMESTAMP())
                AND (ends_at IS NULL OR ends_at>=UTC_TIMESTAMP())
            ORDER BY sort_order,id DESC LIMIT 10`);
        return res.json({success:true,data:rows.map((row)=>({
            id:String(row.id),title:row.title,subtitle:row.subtitle,imageUrl:row.image_url,
            targetUrl:row.target_url,buttonText:row.button_text,sortOrder:Number(row.sort_order)
        }))});
    } catch(error) { return next(error); }
}

async function recommendations(req,res,next){
    const limit=getNumber(req.query.limit,8);
    if(!Number.isInteger(limit)||limit<1||limit>20)return res.status(400).json({success:false,message:'Recommendation limit must be between 1 and 20.'});
    try{
        const result=await recommendProducts(req.user?.id||null,limit);
        return res.json({success:true,data:{method:result.method,total:result.total,items:result.items.map(({product,reasons})=>({...present(product),reasons}))}});
    }catch(error){return next(error)}
}

async function detail(req, res, next) {
    try {
        const [rows] = await pool.execute(`SELECT p.*,c.name category_name,COALESCE(rv.average_rating,0) average_rating,COALESCE(rv.review_count,0) review_count
            FROM products p LEFT JOIN categories c ON c.id=p.category_id
            LEFT JOIN (SELECT product_id,AVG(rating) average_rating,COUNT(*) review_count FROM reviews WHERE is_approved=1 GROUP BY product_id) rv ON rv.product_id=p.id
            WHERE p.id=? AND p.status='ACTIVE' LIMIT 1`, [req.params.id]);
        if (!rows[0]) return res.status(404).json({ success: false, message: 'Product not found.' });
        await pool.execute("INSERT INTO product_events (user_id,product_id,event_type) VALUES (?,?,'VIEW')", [req.user?.id || null, req.params.id]);
        const [images] = await pool.execute('SELECT image_url,alt_text FROM product_images WHERE product_id=? ORDER BY sort_order,id', [req.params.id]);
        const product = { ...present(rows[0]), images:[
            ...(rows[0].image_url ? [{url:rows[0].image_url,altText:rows[0].name}] : []),
            ...images.map((image)=>({url:image.image_url,altText:image.alt_text||rows[0].name}))
        ] };
        const [related] = await pool.execute(`SELECT p.*,c.name category_name,0 average_rating,0 review_count FROM products p
            LEFT JOIN categories c ON c.id=p.category_id WHERE p.status='ACTIVE' AND p.category_id <=> ? AND p.id<>? ORDER BY p.is_featured DESC,p.id DESC LIMIT 4`, [rows[0].category_id, req.params.id]);
        return res.json({ success: true, data: { product, related: related.map(present) } });
    } catch (error) { return next(error); }
}

async function finder(req, res, next) {
    try {
        const { occasion, recipient, interests = [], style, giftType, query } = req.body || {};
        const budget = req.body?.budget == null || req.body.budget === '' ? null : Number(req.body.budget);
        if (budget !== null && (!Number.isFinite(budget) || budget < 0) || !Array.isArray(interests) || interests.length > 12 ||
            interests.some((value) => typeof value !== 'string' || value.length > 80) ||
            [occasion,recipient,style,giftType,query].some((value) => value != null && (typeof value !== 'string' || value.length > 100)) ||
            !(occasion || recipient || interests.length || style || giftType || query || budget !== null)) {
            return res.status(400).json({ success: false, message: 'Invalid gift finder criteria.' });
        }
        const [rows] = await pool.execute(`SELECT p.*,c.name category_name,0 average_rating,0 review_count FROM products p
            LEFT JOIN categories c ON c.id=p.category_id WHERE p.status='ACTIVE' AND p.stock>0
            AND (? IS NULL OR p.price<=?) ORDER BY p.is_featured DESC,p.id DESC LIMIT 200`, [budget, budget]);
        const norm = (value) => String(value || '').trim().toLowerCase();
        const scored = rows.map((row) => {
            const tags = [...(row.occasion_tags || []), ...(row.recipient_tags || []), ...(row.interest_tags || [])].map(norm);
            const matched = [];
            let score = 0;
            if (occasion && (row.occasion_tags || []).map(norm).includes(norm(occasion))) { score += 5; matched.push(`occasion:${occasion}`); }
            if (recipient && (row.recipient_tags || []).map(norm).includes(norm(recipient))) { score += 4; matched.push(`recipient:${recipient}`); }
            for (const interest of interests) if ((row.interest_tags || []).map(norm).includes(norm(interest))) { score += 3; matched.push(`interest:${interest}`); }
            if (style && norm(row.style) === norm(style)) { score += 2; matched.push(`style:${style}`); }
            if (giftType && norm(row.gift_type) === norm(giftType)) { score += 2; matched.push(`type:${giftType}`); }
            if (query && `${norm(row.name)} ${norm(row.description)} ${tags.join(' ')}`.includes(norm(query))) { score += 2; matched.push('text'); }
            if (budget !== null) { score += 1; matched.push('budget'); }
            if (row.is_featured) score += 0.25;
            return { item: present(row), score, matched };
        }).filter((row) => row.score > 0).sort((a, b) => b.score - a.score || a.item.price - b.item.price).slice(0, 12)
            .map(({ item, matched }) => ({ ...item, reasons: matched.filter((value) => value !== 'text').map((value) => {
                const [kind, label] = value.split(':');
                return kind === 'occasion' ? `Đúng dịp ${label}` : kind === 'recipient' ? `Phù hợp người nhận ${label}` : kind === 'interest' ? `Khớp sở thích ${label}` : kind === 'style' ? `Đúng phong cách ${label}` : kind === 'type' ? `Đúng loại quà ${label}` : kind === 'budget' ? `Trong ngân sách ${Number(budget).toLocaleString('vi-VN')} ₫` : `Khớp nội dung ${query}`;
            }) }));
        return res.json({ success: true, data: { items: scored, method: 'content_match', total: scored.length } });
    } catch (error) { return next(error); }
}

async function track(req, res, next) {
    try {
        const { productId, eventType, searchTerm, context } = req.body || {};
        const allowed = ['SEARCH','FAVORITE','CART_ADD','RECOMMENDATION_CLICK'];
        if (!allowed.includes(eventType) || (productId != null && !/^\d+$/.test(String(productId))) ||
            (eventType === 'SEARCH' && typeof searchTerm !== 'string') ||
            (searchTerm != null && (typeof searchTerm !== 'string' || searchTerm.length > 255)) ||
            (context != null && (typeof context !== 'object' || Array.isArray(context)))) {
            return res.status(400).json({ success: false, message: 'Invalid event.' });
        }
        let contextJson=null;
        if(context!=null){contextJson=JSON.stringify(context);if(contextJson.length>2000)return res.status(400).json({success:false,message:'Event context is too large.'})}
        if(productId!=null){const [[product]]=await pool.execute('SELECT id FROM products WHERE id=?',[productId]);if(!product)return res.status(404).json({success:false,message:'Product not found.'})}
        await pool.execute('INSERT INTO product_events (user_id,product_id,event_type,search_term,context) VALUES (?,?,?,?,?)',
            [req.user?.id || null, productId || null, eventType, searchTerm || null, contextJson]);
        return res.status(202).json({ success: true });
    } catch (error) { return next(error); }
}

module.exports = { list, categories, lookup, banners, recommendations, detail, finder, track, present };
