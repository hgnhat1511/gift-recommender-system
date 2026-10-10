const pool = require('../config/db');

const eventWeight = {
    PURCHASE: 5,
    FAVORITE: 4,
    CART_ADD: 3,
    RECOMMENDATION_CLICK: 2,
    VIEW: 1
};

const normalize = (value) => String(value || '').trim().toLowerCase();

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
        reasons: reasons.length ? reasons : ['S\u1ea3n ph\u1ea9m c\u00f2n h\u00e0ng trong catalog']
    }));
    return {
        method: isPersonalized ? 'personalized_activity' : 'popular_cold_start',
        items,
        total: items.length
    };
}

module.exports = { recommendProducts };
