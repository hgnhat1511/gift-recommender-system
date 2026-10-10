const pool = require('../config/db');
const { present } = require('./catalogController');

function quantity(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 1 && number <= 99 ? number : null;
}

async function list(req, res, next) {
    try {
        const [rows] = await pool.execute(`SELECT ci.id cart_item_id,ci.quantity,ci.is_selected,p.*,c.name category_name,0 average_rating,0 review_count
            FROM cart_items ci LEFT JOIN products p ON p.id=ci.product_id LEFT JOIN categories c ON c.id=p.category_id
            WHERE ci.user_id=? ORDER BY ci.created_at DESC`, [req.user.id]);
        const items = rows.map((row) => ({ cartItemId:String(row.cart_item_id), quantity:Number(row.quantity), selected:Boolean(row.is_selected),
            product: row.id == null ? null : present(row), available: row.status === 'ACTIVE' && Number(row.stock) >= Number(row.quantity) }));
        const selectedItems=items.filter((item)=>item.selected);
        const subtotal = selectedItems.reduce((total,item) => total + (item.product ? item.product.price * item.quantity : 0), 0);
        return res.json({ success: true, data: { items, itemCount: items.reduce((n,item) => n + item.quantity,0), selectedItemCount:selectedItems.reduce((n,item)=>n+item.quantity,0), subtotal } });
    } catch (error) { return next(error); }
}

async function add(req, res, next) {
    const qty = quantity(req.body?.quantity ?? 1);
    if (!/^\d+$/.test(String(req.body?.productId || '')) || !qty) return res.status(400).json({ success:false,message:'Invalid product or quantity.' });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [products] = await connection.execute("SELECT id,stock FROM products WHERE id=? AND status='ACTIVE' FOR UPDATE", [req.body.productId]);
        if (!products[0]) { await connection.rollback(); return res.status(404).json({ success:false,message:'Product not found or inactive.' }); }
        const [items] = await connection.execute('SELECT quantity FROM cart_items WHERE user_id=? AND product_id=? FOR UPDATE', [req.user.id,req.body.productId]);
        const target = qty + Number(items[0]?.quantity || 0);
        if (target > Number(products[0].stock)) { await connection.rollback(); return res.status(409).json({ success:false,message:`Only ${products[0].stock} item(s) are currently available.`,data:{stock:Number(products[0].stock)} }); }
        await connection.execute(`INSERT INTO cart_items (user_id,product_id,quantity) VALUES (?,?,?)
            ON DUPLICATE KEY UPDATE quantity=VALUES(quantity),is_selected=TRUE`, [req.user.id,req.body.productId,target]);
        await connection.execute("INSERT INTO product_events (user_id,product_id,event_type) VALUES (?,?,'CART_ADD')", [req.user.id,req.body.productId]);
        await connection.commit();
        return res.status(201).json({ success:true,message:'Added to cart.' });
    } catch (error) { await connection.rollback(); return next(error); }
    finally { connection.release(); }
}

async function merge(req, res, next) {
    const { mergeKey, items } = req.body || {};
    if (typeof mergeKey !== 'string' || !/^[A-Za-z0-9:_-]{8,80}$/.test(mergeKey) ||
        !Array.isArray(items) || items.length < 1 || items.length > 50) {
        return res.status(400).json({ success:false,message:'Invalid guest cart merge request.' });
    }
    const requested = new Map();
    for (const item of items) {
        const productId = String(item?.productId || '');
        const qty = quantity(item?.quantity);
        if (!/^\d{1,20}$/.test(productId) || !qty || typeof item?.selected !== 'boolean' || requested.has(productId)) {
            return res.status(400).json({ success:false,message:'Guest cart contains an invalid or duplicate item.' });
        }
        requested.set(productId, { quantity:qty, selected:item.selected });
    }

    const productIds = [...requested.keys()].sort((a,b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [previous] = await connection.execute(
            'SELECT merge_key FROM cart_merge_requests WHERE user_id=? AND merge_key=? FOR UPDATE',
            [req.user.id, mergeKey]
        );
        if (previous.length) {
            await connection.commit();
            return res.json({ success:true,message:'Guest cart was already merged.',data:{ alreadyMerged:true } });
        }

        const placeholders = productIds.map(() => '?').join(',');
        const [products] = await connection.execute(
            `SELECT id,name,stock,status FROM products WHERE id IN (${placeholders}) ORDER BY id FOR UPDATE`,
            productIds
        );
        const byId = new Map(products.map((product) => [String(product.id), product]));
        const [existingRows] = await connection.execute(
            `SELECT product_id,quantity FROM cart_items WHERE user_id=? AND product_id IN (${placeholders}) ORDER BY product_id FOR UPDATE`,
            [req.user.id, ...productIds]
        );
        const inCart = new Map(existingRows.map((item) => [String(item.product_id), Number(item.quantity)]));
        for (const productId of productIds) {
            const product = byId.get(productId);
            const requestedItem = requested.get(productId);
            const current = inCart.get(productId) || 0;
            const total = current + requestedItem.quantity;
            if (!product || product.status !== 'ACTIVE') {
                await connection.rollback();
                return res.status(409).json({ success:false,message:`A guest cart product is no longer available. Remove it and retry.`,data:{ productId, unavailable:true } });
            }
            if (total > Number(product.stock) || total > 99) {
                await connection.rollback();
                return res.status(409).json({ success:false,message:`Not enough current stock for ${product.name}. Adjust the guest cart and retry.`,data:{ productId, name:product.name, stock:Number(product.stock), alreadyInCart:current, guestQuantity:requestedItem.quantity } });
            }
        }

        await connection.execute('INSERT INTO cart_merge_requests (user_id,merge_key) VALUES (?,?)', [req.user.id,mergeKey]);
        for (const productId of productIds) {
            const item = requested.get(productId);
            await connection.execute(`INSERT INTO cart_items (user_id,product_id,quantity,is_selected) VALUES (?,?,?,?)
                ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity),is_selected=GREATEST(is_selected,VALUES(is_selected))`,
            [req.user.id,productId,item.quantity,item.selected]);
            await connection.execute("INSERT INTO product_events (user_id,product_id,event_type) VALUES (?,?,'CART_ADD')", [req.user.id,productId]);
        }
        await connection.commit();
        return res.json({ success:true,message:'Guest cart merged.',data:{ mergedItemCount:productIds.length } });
    } catch (error) {
        await connection.rollback();
        if (error.code === 'ER_DUP_ENTRY') {
            try {
                const [[previous]] = await pool.execute('SELECT merge_key FROM cart_merge_requests WHERE user_id=? AND merge_key=? LIMIT 1', [req.user.id,mergeKey]);
                if (previous) return res.json({ success:true,message:'Guest cart was already merged.',data:{ alreadyMerged:true } });
            } catch (readError) { return next(readError); }
        }
        return next(error);
    } finally { connection.release(); }
}

async function update(req, res, next) {
    const qty = quantity(req.body?.quantity);
    if (!qty || !/^\d+$/.test(String(req.params.itemId))) return res.status(400).json({ success:false,message:'Invalid quantity.' });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [rows] = await connection.execute(`SELECT ci.id,p.stock,p.status FROM cart_items ci JOIN products p ON p.id=ci.product_id
            WHERE ci.id=? AND ci.user_id=? FOR UPDATE`, [req.params.itemId,req.user.id]);
        if (!rows[0]) { await connection.rollback(); return res.status(404).json({ success:false,message:'Cart item not found.' }); }
        if (rows[0].status !== 'ACTIVE' || qty > Number(rows[0].stock)) { await connection.rollback(); return res.status(409).json({ success:false,message:'Requested quantity is not available.',data:{stock:Number(rows[0].stock)} }); }
        await connection.execute('UPDATE cart_items SET quantity=? WHERE id=?', [qty,req.params.itemId]);
        await connection.commit();
        return res.json({ success:true });
    } catch (error) { await connection.rollback(); return next(error); }
    finally { connection.release(); }
}

async function updateSelection(req,res,next){
    if(!/^\d+$/.test(String(req.params.itemId||''))||typeof req.body?.isSelected!=='boolean')return res.status(400).json({success:false,message:'isSelected must be a boolean.'});
    const connection=await pool.getConnection();
    try{
        await connection.beginTransaction();
        const [rows]=await connection.execute('SELECT id FROM cart_items WHERE id=? AND user_id=? FOR UPDATE',[req.params.itemId,req.user.id]);
        if(!rows[0]){await connection.rollback();return res.status(404).json({success:false,message:'Cart item not found.'})}
        await connection.execute('UPDATE cart_items SET is_selected=? WHERE id=?',[req.body.isSelected,req.params.itemId]);
        await connection.commit();
        return res.json({success:true,data:{isSelected:req.body.isSelected}});
    }catch(error){await connection.rollback();return next(error)}finally{connection.release()}
}
async function remove(req, res, next) {
    try {
        const [result] = await pool.execute('DELETE FROM cart_items WHERE id=? AND user_id=?', [req.params.itemId,req.user.id]);
        if (!result.affectedRows) return res.status(404).json({ success:false,message:'Cart item not found.' });
        return res.json({ success:true });
    } catch (error) { return next(error); }
}

async function clear(req, res, next) {
    try { await pool.execute('DELETE FROM cart_items WHERE user_id=?', [req.user.id]); return res.json({ success:true }); }
    catch (error) { return next(error); }
}

module.exports = { list, add, merge, update, updateSelection, remove, clear };
