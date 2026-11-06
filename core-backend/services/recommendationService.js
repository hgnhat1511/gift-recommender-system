const pool = require('../config/db');

const eventWeight = {
    PURCHASE: 5,
    FAVORITE: 4,
    CART_ADD: 3,
    RECOMMENDATION_CLICK: 2,
    VIEW: 1
};

const normalize = (value) => String(value || '').trim().toLowerCase();

function mlProduct(product, maxPopularity = 1, maxRating = 1) {
    return {
        id:String(product.id),name:product.name||'',description:product.description||'',status:product.status,
        stock:Number(product.stock),price:Number(product.price),categoryId:product.category_id??product.categoryId,
        occasionTags:jsonList(product.occasion_tags??product.occasionTags),recipientTags:jsonList(product.recipient_tags??product.recipientTags),
        interestTags:jsonList(product.interest_tags??product.interestTags),style:product.style,giftType:product.gift_type??product.giftType,
        isFeatured:Boolean(product.is_featured??product.isFeatured),
        popularityScore:Number(product.event_count||0)/maxPopularity,ratingScore:Number(product.average_rating||0)/maxRating
    };
}

function mlPayload(ranked, profile, limit) {
    const preferences = {};
    for (const [group, values] of Object.entries(profile)) {
        const max = Math.max(0,...[...values.values()].map((item)=>item.weight));
        preferences[group] = Object.fromEntries([...values.values()].map((item)=>[item.label,max?Math.min(1,item.weight/max):0]));
    }
    const maxPopularity=Math.max(1,...ranked.map(({product})=>Number(product.event_count||0)));
    const maxRating=Math.max(1,...ranked.map(({product})=>Number(product.average_rating||0)));
    return {limit,preferences,products:ranked.map(({product})=>mlProduct(product,maxPopularity,maxRating))};
}

function applyMlRanking(ranked, response) {
    if(!Array.isArray(response?.items))return null;
    const byId=new Map(ranked.map((item)=>[String(item.product.id),item.product]));
    const seen=new Set();
    const items=[];
    for(const result of response.items){
        const id=String(result?.id||'');
        if(!byId.has(id)||seen.has(id)||!Array.isArray(result.reasons)||result.reasons.some((reason)=>typeof reason!=='string'))return null;
        seen.add(id);items.push({product:byId.get(id),reasons:result.reasons});
    }
    return items;
}

function applyMlRankerMapping(ranked, response) {
    if (!Array.isArray(response?.items)) return null;
    const byMlId = new Map();
    for (const item of ranked) {
        const key = String(item.product.ml_product_id ?? item.product.id);
        byMlId.set(key, item.product);
    }
    const seen = new Set();
    const items = [];
    for (const result of response.items) {
        const id = String(result?.id || '');
        if (!byMlId.has(id) || seen.has(id)) continue;
        seen.add(id);
        const reasons = Array.isArray(result.reasons) ? result.reasons : [];
        items.push({
            product: byMlId.get(id),
            reasons: reasons.length ? reasons : ['Gợi ý từ mô hình học máy LC-1']
        });
    }
    return items;
}

async function askMlRanking(path, ranked, payload) {
    const base=process.env.ML_SERVICE_URL;
    if(!base)return null;
    const timeout=Math.max(100,Math.min(5000,Number(process.env.ML_SERVICE_TIMEOUT_MS)||1500));
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeout);
    try{
        const response=await fetch(new URL(path,base),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
        if(!response.ok)return null;
        const result=await response.json();
        return applyMlRanking(ranked,result);
    }catch{return null}finally{clearTimeout(timer)}
}

async function askMlRanker(userId, ranked, limit) {
    const base = process.env.ML_SERVICE_URL;
    if (!base) return null;
    const timeout = Math.max(100, Math.min(5000, Number(process.env.ML_SERVICE_TIMEOUT_MS) || 1500));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const validCandidates = ranked.filter(item => {
            const mlId = item.product.ml_product_id ?? item.product.id;
            return Number.isInteger(Number(mlId));
        });

        if (validCandidates.length === 0) {
            return { items: [], source: 'unknown_candidates' };
        }

        const candidateIds = validCandidates.map(item => Number(item.product.ml_product_id ?? item.product.id));

        const payload = {
            user_id: Number.isInteger(Number(userId)) ? Number(userId) : null,
            top_k: limit,
            candidate_ids: candidateIds
        };
        const response = await fetch(new URL('/recommend/rank', base), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        if (!response.ok) return null;
        const result = await response.json();
        const source = result?.source || 'unknown_candidates';
        if (source === 'unknown_candidates') {
            return { items: [], source: 'unknown_candidates' };
        }
        const items = applyMlRankerMapping(validCandidates, result);
        if (!items || items.length === 0) return null;
        return { items, source };
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function askMlService(ranked, profile, limit) {
    return askMlRanking('/recommendations',ranked,mlPayload(ranked,profile,limit));
}

async function askMlGiftFinder(products, criteria) {
    const ranked=products.map((product)=>({product}));
    const preferences={};
    if(criteria.occasion)preferences.occasions={[criteria.occasion]:1};
    if(criteria.recipient)preferences.recipients={[criteria.recipient]:1};
    if(criteria.interests?.length)preferences.interests=Object.fromEntries(criteria.interests.map((value)=>[value,1]));
    if(criteria.style)preferences.styles={[criteria.style]:1};
    if(criteria.giftType)preferences.giftTypes={[criteria.giftType]:1};
    const maxPopularity=Math.max(1,...products.map((product)=>Number(product.event_count||0)));
    const maxRating=Math.max(1,...products.map((product)=>Number(product.average_rating||0)));
    const payload={limit:12,preferences,context:{occasion:criteria.occasion,recipient:criteria.recipient,budget:criteria.budget,query:criteria.query},products:products.map((product)=>mlProduct(product,maxPopularity,maxRating))};
    return askMlRanking('/gift-finder',ranked,payload);
}

function jsonList(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function addSignal(map, key, weight) {
    const normalized = normalize(key);
    if (!normalized) return;
    const current = map.get(normalized) || { weight: 0, label: String(key).trim() };
    current.weight += weight;
    map.set(normalized, current);
}

function decay(createdAt) {
    const timestamp = new Date(createdAt).getTime();
    if (!Number.isFinite(timestamp)) return 1;
    const ageDays = Math.max(0, (Date.now() - timestamp) / 86400000);
    return Math.exp(-ageDays / 90);
}

async function recommendProducts(userId, limit) {
    const profile = {
        categories: new Map(), occasions: new Map(), recipients: new Map(),
        interests: new Map(), styles: new Map(), giftTypes: new Map()
    };
    let hasSignals = false;

    if (userId) {
        const [events] = await pool.execute(`
            SELECT e.event_type, e.created_at, p.category_id, c.name AS category_name,
                p.occasion_tags, p.recipient_tags, p.interest_tags, p.style, p.gift_type
            FROM product_events e
            JOIN products p ON p.id = e.product_id
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE e.user_id = ?
                AND e.event_type IN ('VIEW', 'CART_ADD', 'PURCHASE', 'RECOMMENDATION_CLICK')
                AND e.created_at >= DATE_SUB(NOW(), INTERVAL 180 DAY)
            ORDER BY e.created_at DESC, e.id DESC
            LIMIT 300`, [userId]);
        const [favorites] = await pool.execute(`
            SELECT f.created_at, p.category_id, c.name AS category_name,
                p.occasion_tags, p.recipient_tags, p.interest_tags, p.style, p.gift_type
            FROM favorites f
            JOIN products p ON p.id = f.product_id
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE f.user_id = ?
            ORDER BY f.created_at DESC
            LIMIT 100`, [userId]);

        const signals = [
            ...events.map((row) => ({ ...row, weight: eventWeight[row.event_type] || 1 })),
            ...favorites.map((row) => ({ ...row, weight: eventWeight.FAVORITE }))
        ];
        hasSignals = signals.length > 0;

        for (const signal of signals) {
            const weight = signal.weight * decay(signal.created_at);
            if (signal.category_id != null) addSignal(profile.categories, signal.category_id, weight);
            for (const tag of jsonList(signal.occasion_tags)) addSignal(profile.occasions, tag, weight);
            for (const tag of jsonList(signal.recipient_tags)) addSignal(profile.recipients, tag, weight);
            for (const tag of jsonList(signal.interest_tags)) addSignal(profile.interests, tag, weight);
            addSignal(profile.styles, signal.style, weight);
            addSignal(profile.giftTypes, signal.gift_type, weight);
        }
    }

    const exclusion = userId
        ? `AND p.id NOT IN (
            SELECT product_id FROM cart_items WHERE user_id = ?
            UNION
            SELECT product_id FROM favorites WHERE user_id = ?
        )`
        : '';
    const params = userId ? [userId, userId] : [];
    const [products] = await pool.execute(`
        SELECT p.*, c.name AS category_name,
            COALESCE(rv.average_rating, 0) AS average_rating,
            COALESCE(rv.review_count, 0) AS review_count,
            COALESCE(pop.event_count, 0) AS event_count
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN (
            SELECT product_id, AVG(rating) AS average_rating, COUNT(*) AS review_count
            FROM reviews WHERE is_approved = 1 GROUP BY product_id
        ) rv ON rv.product_id = p.id
        LEFT JOIN (
            SELECT product_id, COUNT(*) AS event_count
            FROM product_events
            WHERE event_type IN ('VIEW', 'CART_ADD', 'PURCHASE')
                AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY product_id
        ) pop ON pop.product_id = p.id
        WHERE p.status = 'ACTIVE' AND p.stock > 0 ${exclusion}
        ORDER BY p.is_featured DESC, p.created_at DESC, p.id DESC
        LIMIT 500`, params);

    const maxOf = (map) => Math.max(0, ...[...map.values()].map((item) => item.weight));
    const maxima = {
        categories: maxOf(profile.categories), occasions: maxOf(profile.occasions),
        recipients: maxOf(profile.recipients), interests: maxOf(profile.interests),
        styles: maxOf(profile.styles), giftTypes: maxOf(profile.giftTypes)
    };
    const popularMax = Math.max(1, ...products.map((product) => Number(product.event_count || 0)));
    const ratingMax = Math.max(1, ...products.map((product) => Number(product.average_rating || 0)));

    const ranked = products.map((product) => {
        const reasons = [];
        let preferenceScore = 0;
        const category = profile.categories.get(normalize(product.category_id));
        if (category && maxima.categories) {
            preferenceScore += 4 * category.weight / maxima.categories;
            reasons.push('\u0050h\u00f9 h\u1ee3p danh m\u1ee5c b\u1ea1n t\u1eebng quan t\u00e2m: ' + (product.category_name || category.label));
        }

        const matchGroup = (source, values, maximum, score, label) => {
            if (!maximum) return;
            const matches = jsonList(values)
                .map((value) => source.get(normalize(value)))
                .filter(Boolean)
                .sort((a, b) => b.weight - a.weight);
            for (const match of matches.slice(0, 2)) {
                preferenceScore += score * match.weight / maximum;
                reasons.push(label + match.label);
            }
        };

        matchGroup(profile.occasions, product.occasion_tags, maxima.occasions, 1.5, '\u0110\u00fang d\u1ecbp: ');
        matchGroup(profile.recipients, product.recipient_tags, maxima.recipients, 1.5, '\u0110\u00fang ng\u01b0\u1eddi nh\u1eadn: ');
        matchGroup(profile.interests, product.interest_tags, maxima.interests, 2, '\u0110\u00fang s\u1edf th\u00edch: ');

        const style = profile.styles.get(normalize(product.style));
        if (style && maxima.styles) {
            preferenceScore += 1.5 * style.weight / maxima.styles;
            reasons.push('\u0110\u00fang phong c\u00e1ch b\u1ea1n t\u1eebng xem: ' + style.label);
        }
        const giftType = profile.giftTypes.get(normalize(product.gift_type));
        if (giftType && maxima.giftTypes) {
            preferenceScore += 1.5 * giftType.weight / maxima.giftTypes;
            reasons.push('\u0110\u00fang lo\u1ea1i qu\u00e0 b\u1ea1n t\u1eebng quan t\u00e2m: ' + giftType.label);
        }

        const popularity = Number(product.event_count || 0) / popularMax;
        const rating = Number(product.average_rating || 0) / ratingMax;
        const baselineScore = 0.25 * popularity + 0.1 * rating + (product.is_featured ? 0.15 : 0);
        if (popularity > 0 && !reasons.length) reasons.push('\u0110\u01b0\u1ee3c quan t\u00e2m g\u1ea7n \u0111\u00e2y');
        if (product.is_featured && !reasons.length) reasons.push('\u0110\u01b0\u1ee3c c\u1eeda h\u00e0ng gi\u1edbi thi\u1ec7u');
        return { product, score: preferenceScore + baselineScore, preferenceScore, reasons };
    });

    const isPersonalized = hasSignals && ranked.some((item) => item.preferenceScore > 0);
    ranked.sort((a, b) => b.score - a.score
        || Number(b.product.is_featured) - Number(a.product.is_featured)
        || Number(b.product.event_count) - Number(a.product.event_count)
        || Number(b.product.id) - Number(a.product.id));

    const items = ranked.slice(0, limit).map(({ product, reasons }) => ({
        product,
        reasons: reasons.length ? reasons : ['Sản phẩm còn hàng trong danh mục']
    }));

    // 1. Thử gọi Ranker LC-1 (FastAPI) phục vụ xếp hạng thời gian thực
    let mlUserId = null;
    if (userId) {
        try {
            const [userRows] = await pool.execute('SELECT ml_user_id FROM users WHERE id = ? LIMIT 1', [userId]);
            if (userRows.length && userRows[0].ml_user_id != null) {
                mlUserId = Number(userRows[0].ml_user_id);
            }
        } catch {
            mlUserId = null;
        }
    }

    const rankerRes = await askMlRanker(mlUserId, ranked, limit);
    if (rankerRes && Array.isArray(rankerRes.items) && rankerRes.items.length > 0 && (rankerRes.source === 'ranker_lc1' || rankerRes.source === 'popularity_fallback')) {
        return {
            method: isPersonalized ? 'personalized_activity' : 'popular_cold_start',
            items: rankerRes.items,
            total: rankerRes.items.length,
            source: rankerRes.source
        };
    }

    // 2. Fallback sang Python rule/TF-IDF hoặc Node rule-based khi ML lỗi hoặc chậm
    const pythonItems = await askMlService(ranked, profile, limit);
    const chosenSource = resolveRecommendationSource(rankerRes, pythonItems);
    return {
        method: isPersonalized ? 'personalized_activity' : 'popular_cold_start',
        items: pythonItems || items,
        total: pythonItems ? pythonItems.length : items.length,
        source: chosenSource
    };
}

function resolveRecommendationSource(rankerRes, pythonItems) {
    if (rankerRes && Array.isArray(rankerRes.items) && rankerRes.items.length > 0) {
        if (rankerRes.source === 'ranker_lc1' || rankerRes.source === 'popularity_fallback') {
            return rankerRes.source;
        }
    }
    return pythonItems ? 'python_content_baseline' : 'node_fallback';
}

module.exports = { recommendProducts, mlPayload, applyMlRanking, askMlService, askMlGiftFinder, askMlRanker, resolveRecommendationSource };
