const crypto = require('node:crypto');
const pool = require('../config/db');

const cents = (value) => Math.round(Number(value) * 100);
const amount = (value) => Number((value / 100).toFixed(2));
function configuredAmount(name, fallback) {
    if (process.env[name] == null || process.env[name] === '') return fallback;
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}
const shippingFee = configuredAmount('SHIPPING_FEE', 30000);
const expressShippingFee = configuredAmount('EXPRESS_SHIPPING_FEE', 50000);
const shippingMethods = { STANDARD: shippingFee, EXPRESS: expressShippingFee };
const freeShippingMinimum = configuredAmount('FREE_SHIPPING_MINIMUM', 500000);

async function quoteTotals(connection, userId, addressId, couponCode, lock = false, shippingMethod = 'STANDARD') {
    const [addresses] = await connection.execute('SELECT * FROM addresses WHERE id=? AND user_id=?', [addressId,userId]);
    if (!addresses[0]) return { error:'Choose a saved delivery address.' };
    const [items] = await connection.execute(`SELECT ci.product_id,ci.quantity,p.name,p.image_url,p.price,p.stock,p.status,p.category_id,c.name category_name
        FROM cart_items ci LEFT JOIN products p ON p.id=ci.product_id LEFT JOIN categories c ON c.id=p.category_id
        WHERE ci.user_id=? AND ci.is_selected=1 ${lock ? 'FOR UPDATE' : ''}`, [userId]);
    if (!items.length) return { error:'Select at least one product from your cart.' };
    if (items.some((item) => !item.name || item.status !== 'ACTIVE')) return { error:'One or more cart products are no longer available.' };
    if (items.some((item) => Number(item.quantity) > Number(item.stock))) return { error:'A cart quantity exceeds current stock. Update your cart before checkout.' };
    const subtotalCents = items.reduce((sum,item) => sum + cents(item.price) * Number(item.quantity), 0);
    let coupon = null; let discountCents = 0; let discountBaseCents = null; let eligibleCategoryNames = [];
    if (couponCode) {
        const code = String(couponCode).trim().toUpperCase();
        const [coupons] = await connection.execute(`SELECT * FROM coupons WHERE code=? AND is_active=1
            AND (starts_at IS NULL OR starts_at<=NOW()) AND (ends_at IS NULL OR ends_at>=NOW()) ${lock ? 'FOR UPDATE' : ''}`, [code]);
        coupon = coupons[0];
        if (!coupon) return { error:'This coupon is invalid or expired.' };
        const [couponCategories] = await connection.execute(`SELECT cc.category_id,c.name FROM coupon_categories cc
            JOIN categories c ON c.id=cc.category_id WHERE cc.coupon_id=? ${lock ? 'FOR UPDATE' : ''}`, [coupon.id]);
        const eligibleCategoryIds = new Set(couponCategories.map((row)=>String(row.category_id)));
        const eligibleItems = eligibleCategoryIds.size ? items.filter((item)=>eligibleCategoryIds.has(String(item.category_id))) : items;
        if (!eligibleItems.length) return { error:'This coupon does not apply to the selected products.' };
        discountBaseCents = eligibleItems.reduce((sum,item)=>sum+cents(item.price)*Number(item.quantity),0);
        eligibleCategoryNames = couponCategories.map((row)=>row.name);
        if (discountBaseCents < cents(coupon.min_subtotal)) return { error:`Minimum eligible subtotal for this coupon is ${Number(coupon.min_subtotal)} VND.` };
        if (coupon.usage_limit != null && Number(coupon.used_count) >= Number(coupon.usage_limit)) return { error:'This coupon has reached its usage limit.' };
        const [[used]] = await connection.execute('SELECT COUNT(*) total FROM coupon_uses WHERE coupon_id=? AND user_id=?', [coupon.id,userId]);
        if (Number(used.total) >= Number(coupon.per_user_limit)) return { error:'You have already used this coupon the allowed number of times.' };
        discountCents = coupon.discount_type === 'PERCENT'
            ? Math.floor(discountBaseCents * Number(coupon.discount_value) / 100)
            : cents(coupon.discount_value);
        if (coupon.max_discount != null) discountCents = Math.min(discountCents,cents(coupon.max_discount));
        discountCents = Math.min(discountCents,discountBaseCents);
    }
    if (!Object.hasOwn(shippingMethods, shippingMethod)) return { error:'Choose a valid delivery method.' };
    const amountAfterDiscountCents = subtotalCents - discountCents;
    const shippingOptions = Object.entries(shippingMethods).map(([method, fee]) => {
        const free = method === 'STANDARD' && amountAfterDiscountCents >= cents(freeShippingMinimum);
        return { method, feeCents:free ? 0 : cents(fee), free };
    });
    const shippingCents = shippingOptions.find((option) => option.method === shippingMethod).feeCents;
    return { address:addresses[0], items, coupon, subtotalCents, discountCents, discountBaseCents, eligibleCategoryNames, shippingMethod, shippingCents, shippingOptions, totalCents:amountAfterDiscountCents+shippingCents };
}

async function quote(req, res, next) {
    if (!/^\d+$/.test(String(req.body?.addressId || '')) ||
        (req.body?.couponCode != null && (typeof req.body.couponCode !== 'string' || req.body.couponCode.length > 40)) ||
        (req.body?.shippingMethod != null && !Object.hasOwn(shippingMethods, req.body.shippingMethod))) {
        return res.status(400).json({ success:false,message:'Choose a saved address, valid delivery method, and valid coupon code.' });
    }
    const connection = await pool.getConnection();
    try {
        const shippingMethod = req.body?.shippingMethod || 'STANDARD';
        const totals = await quoteTotals(connection,req.user.id,req.body?.addressId,req.body?.couponCode,false,shippingMethod);
        if (totals.error) return res.status(400).json({ success:false,message:totals.error });
        return res.json({ success:true,data:{ subtotal:amount(totals.subtotalCents),discount:amount(totals.discountCents),discountEligibleSubtotal:totals.discountBaseCents==null?null:amount(totals.discountBaseCents),coupon:totals.coupon?{code:totals.coupon.code,categoryNames:totals.eligibleCategoryNames}:null,shippingMethod:totals.shippingMethod,shippingFee:amount(totals.shippingCents),shippingOptions:totals.shippingOptions.map((option)=>({method:option.method,fee:amount(option.feeCents),free:option.free})),total:amount(totals.totalCents),paymentMethod:'COD' } });
    } catch (error) { return next(error); }
    finally { connection.release(); }
}

async function create(req, res, next) {
    if (!/^\d+$/.test(String(req.body?.addressId || '')) ||
        (req.body?.couponCode != null && (typeof req.body.couponCode !== 'string' || req.body.couponCode.length > 40)) ||
        (req.body?.note != null && (typeof req.body.note !== 'string' || req.body.note.length > 1000)) ||
        (req.body?.shippingMethod != null && !Object.hasOwn(shippingMethods, req.body.shippingMethod)) ||
        (req.body?.paymentMethod && req.body.paymentMethod !== 'COD')) {
        return res.status(400).json({ success:false,message:'Invalid checkout information. Choose a supported delivery method; COD is the only available payment method.' });
    }
    const requestKey=req.get('Idempotency-Key')?.trim()||null;
    if(requestKey&&(!/^[A-Za-z0-9:_-]{8,100}$/.test(requestKey)))return res.status(400).json({success:false,message:'Invalid Idempotency-Key.'});
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        if(requestKey){
            const [existing]=await connection.execute('SELECT id,order_code,status,total_amount,shipping_method FROM orders WHERE user_id=? AND idempotency_key=? LIMIT 1 FOR UPDATE',[req.user.id,requestKey]);
            if(existing[0]){await connection.commit();return res.status(200).json({success:true,message:'This checkout request was already processed.',data:{orderId:String(existing[0].id),orderCode:existing[0].order_code,status:existing[0].status,paymentMethod:'COD',shippingMethod:existing[0].shipping_method||'STANDARD',total:Number(existing[0].total_amount)}})}
        }
        const totals = await quoteTotals(connection,req.user.id,req.body.addressId,req.body.couponCode,true,req.body.shippingMethod||'STANDARD');
        if (totals.error) { await connection.rollback(); return res.status(409).json({ success:false,message:totals.error }); }
        const orderCode = `GL${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const address = totals.address;
        const [created] = await connection.execute(`INSERT INTO orders
            (order_code,idempotency_key,user_id,status,payment_method,shipping_method,payment_status,recipient_name,phone,shipping_address,customer_note,coupon_code,subtotal,discount_amount,shipping_fee,total_amount)
            VALUES (?,?,?, 'PENDING','COD',?,'UNPAID',?,?,?,?,?,?,?,?,?)`,
            [orderCode,requestKey,req.user.id,totals.shippingMethod,address.recipient_name,address.phone,JSON.stringify({ addressLine:address.address_line,ward:address.ward,district:address.district,city:address.city }),req.body.note?.trim() || null,totals.coupon?.code || null,amount(totals.subtotalCents),amount(totals.discountCents),amount(totals.shippingCents),amount(totals.totalCents)]);
        const orderId = created.insertId;
        await connection.execute('INSERT INTO order_status_history (order_id,changed_by,to_status,note) VALUES (?,?,?,?)', [orderId,req.user.id,'PENDING','Order placed by customer']);
        for (const item of totals.items) {
            const [updated] = await connection.execute('UPDATE products SET stock=stock-? WHERE id=? AND status=\'ACTIVE\' AND stock>=?', [item.quantity,item.product_id,item.quantity]);
            if (updated.affectedRows !== 1) throw Object.assign(new Error('Stock changed during checkout.'),{httpStatus:409});
            await connection.execute('INSERT INTO order_items (order_id,product_id,product_name,image_url,unit_price,quantity,line_total) VALUES (?,?,?,?,?,?,?)',
                [orderId,item.product_id,item.name,item.image_url,Number(item.price),item.quantity,amount(cents(item.price)*Number(item.quantity))]);
            await connection.execute('INSERT INTO inventory_movements (product_id,changed_by,quantity_delta,reason,order_id) VALUES (?,?,?,\'Customer order\',?)', [item.product_id,req.user.id,-Number(item.quantity),orderId]);
            await connection.execute("INSERT INTO product_events (user_id,product_id,event_type) VALUES (?,?,'PURCHASE')", [req.user.id,item.product_id]);
        }
        if (totals.coupon) {
            await connection.execute('UPDATE coupons SET used_count=used_count+1 WHERE id=?', [totals.coupon.id]);
            await connection.execute('INSERT INTO coupon_uses (coupon_id,user_id,order_id,discount_amount) VALUES (?,?,?,?)', [totals.coupon.id,req.user.id,orderId,amount(totals.discountCents)]);
        }
        await connection.execute('DELETE FROM cart_items WHERE user_id=? AND is_selected=1', [req.user.id]);
        await connection.execute("INSERT INTO notifications (user_id,type,title,body,order_id) VALUES (?,'ORDER','Đặt hàng thành công',?,?)", [req.user.id,`Đơn ${orderCode} đã được ghi nhận với hình thức thanh toán khi nhận hàng.`,orderId]);
        await connection.commit();
        return res.status(201).json({ success:true,message:'Order placed.',data:{ orderId:String(orderId),orderCode,status:'PENDING',paymentMethod:'COD',shippingMethod:totals.shippingMethod,total:amount(totals.totalCents) } });
    } catch (error) {
        await connection.rollback();
        if(error.code==='ER_DUP_ENTRY'&&requestKey){
            try{const [[existing]]=await pool.execute('SELECT id,order_code,status,total_amount,shipping_method FROM orders WHERE user_id=? AND idempotency_key=? LIMIT 1',[req.user.id,requestKey]);if(existing)return res.status(200).json({success:true,message:'This checkout request was already processed.',data:{orderId:String(existing.id),orderCode:existing.order_code,status:existing.status,paymentMethod:'COD',shippingMethod:existing.shipping_method||'STANDARD',total:Number(existing.total_amount)}})}catch(readError){return next(readError)}
        }
        if (error.httpStatus) return res.status(error.httpStatus).json({ success:false,message:error.message });
        return next(error);
    } finally { connection.release(); }
}

const orderSelect = `SELECT o.*, (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id) item_count FROM orders o`;

async function reorderMine(req,res,next){
    if(!/^\d+$/.test(String(req.params.id||'')))return res.status(400).json({success:false,message:'Invalid order id.'});
    const connection=await pool.getConnection();
    try{
        await connection.beginTransaction();
        const [orders]=await connection.execute('SELECT id FROM orders WHERE id=? AND user_id=? FOR UPDATE',[req.params.id,req.user.id]);
        if(!orders[0]){await connection.rollback();return res.status(404).json({success:false,message:'Order not found.'})}
        const [orderItems]=await connection.execute('SELECT product_id,product_name,quantity FROM order_items WHERE order_id=? ORDER BY id',[orders[0].id]);
        if(!orderItems.length){await connection.rollback();return res.status(409).json({success:false,message:'This order has no products available to reorder.'})}
        const requested=new Map();
        for(const item of orderItems){
            if(item.product_id==null){await connection.rollback();return res.status(409).json({success:false,message:`${item.product_name} is no longer available.`})}
            const id=String(item.product_id),current=requested.get(id)||{quantity:0,name:item.product_name};current.quantity+=Number(item.quantity);requested.set(id,current);
        }
        const productIds=[...requested.keys()];
        const [products]=await connection.execute(`SELECT id,name,stock,status FROM products WHERE id IN (${productIds.map(()=>'?').join(',')}) ORDER BY id FOR UPDATE`,productIds);
        const byId=new Map(products.map(product=>[String(product.id),product]));
        const [cartRows]=await connection.execute(`SELECT product_id,quantity FROM cart_items WHERE user_id=? AND product_id IN (${productIds.map(()=>'?').join(',')}) FOR UPDATE`,[req.user.id,...productIds]);
        const inCart=new Map(cartRows.map(item=>[String(item.product_id),Number(item.quantity)]));
        for(const [id,item] of requested){
            const product=byId.get(id),target=item.quantity+(inCart.get(id)||0);
            if(!product||product.status!=='ACTIVE'){await connection.rollback();return res.status(409).json({success:false,message:`${item.name} is no longer available.`})}
            if(target>Number(product.stock)||target>99){await connection.rollback();return res.status(409).json({success:false,message:`Not enough current stock to add ${item.name} to your existing cart.`,data:{productId:id,available:Number(product.stock),alreadyInCart:inCart.get(id)||0,requested:item.quantity}})}
        }
        for(const [id,item] of requested){
            const target=item.quantity+(inCart.get(id)||0);
            await connection.execute('INSERT INTO cart_items (user_id,product_id,quantity) VALUES (?,?,?) ON DUPLICATE KEY UPDATE quantity=VALUES(quantity),is_selected=TRUE',[req.user.id,id,target]);
            await connection.execute("INSERT INTO product_events (user_id,product_id,event_type) VALUES (?,?,'CART_ADD')",[req.user.id,id]);
        }
        await connection.commit();
        return res.json({success:true,message:'Available products from the order were added to your cart.',data:{productCount:requested.size}});
    }catch(error){await connection.rollback();return next(error)}finally{connection.release()}
}
async function listMine(req, res, next) {
    try {
        const page = Math.max(1,Number.parseInt(req.query.page,10)||1);
        const limit = Math.min(50,Math.max(1,Number.parseInt(req.query.limit,10)||10));
        const where=['o.user_id=?'];const params=[req.user.id];
        if(req.query.status){where.push('o.status=?');params.push(req.query.status)}
        if(req.query.q){where.push('o.order_code LIKE ?');params.push(`%${String(req.query.q).slice(0,40)}%`)}
        const [rows]=await pool.execute(`${orderSelect} WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,[...params,limit,(page-1)*limit]);
        const [[count]]=await pool.execute(`SELECT COUNT(*) total FROM orders o WHERE ${where.join(' AND ')}`,params);
        return res.json({success:true,data:{items:rows.map(orderView),pagination:{page,limit,total:Number(count.total),pages:Math.ceil(Number(count.total)/limit)}}});
    }catch(error){return next(error)}
}

function orderView(row, items, history, shippingHistory) {
    return { id:String(row.id),orderCode:row.order_code,status:row.status,paymentMethod:row.payment_method,shippingMethod:row.shipping_method||'STANDARD',paymentStatus:row.payment_status,
        recipientName:row.recipient_name,phone:row.phone,shippingAddress:row.shipping_address,customerNote:row.customer_note,couponCode:row.coupon_code,
        shippingCarrier:row.shipping_carrier||null,trackingNumber:row.tracking_number||null,
        subtotal:Number(row.subtotal),discount:Number(row.discount_amount),shippingFee:Number(row.shipping_fee),total:Number(row.total_amount),
        createdAt:row.created_at,updatedAt:row.updated_at,itemCount:Number(row.item_count || 0),items,history,shippingHistory:shippingHistory||[] };
}

async function getOrderData(connection, orderId, whereClause, params) {
    const [orders]=await connection.execute(`${orderSelect} WHERE ${whereClause} LIMIT 1`,params);
    if(!orders[0])return null;
    const [items]=await connection.execute('SELECT id,product_id,product_name,image_url,unit_price,quantity,line_total FROM order_items WHERE order_id=? ORDER BY id',[orderId]);
    const [history]=await connection.execute('SELECT from_status,to_status,note,created_at FROM order_status_history WHERE order_id=? ORDER BY created_at,id',[orderId]);
    const [shippingHistory]=await connection.execute('SELECT carrier,tracking_number,note,created_at FROM order_shipping_history WHERE order_id=? ORDER BY created_at,id',[orderId]);
    return orderView(orders[0],items.map((row)=>({id:String(row.id),productId:row.product_id==null?null:String(row.product_id),name:row.product_name,imageUrl:row.image_url,unitPrice:Number(row.unit_price),quantity:Number(row.quantity),lineTotal:Number(row.line_total)})),history,shippingHistory.map((row)=>({carrier:row.carrier,trackingNumber:row.tracking_number,note:row.note,createdAt:row.created_at})));
}

async function detailMine(req,res,next){
    try{const order=await getOrderData(pool,req.params.id,'o.id=? AND o.user_id=?',[req.params.id,req.user.id]);if(!order)return res.status(404).json({success:false,message:'Order not found.'});return res.json({success:true,data:order})}catch(error){return next(error)}
}

async function cancelMine(req,res,next){
    const connection=await pool.getConnection();
    try{
        await connection.beginTransaction();
        const [orders]=await connection.execute('SELECT * FROM orders WHERE id=? AND user_id=? FOR UPDATE',[req.params.id,req.user.id]);
        const order=orders[0];if(!order){await connection.rollback();return res.status(404).json({success:false,message:'Order not found.'})}
        if(order.status!=='PENDING'){await connection.rollback();return res.status(409).json({success:false,message:'Only pending orders can be cancelled by the customer.'})}
        await restoreStock(connection,order.id,req.user.id);
        await connection.execute("UPDATE orders SET status='CANCELLED' WHERE id=?",[order.id]);
        await connection.execute('INSERT INTO order_status_history (order_id,changed_by,from_status,to_status,note) VALUES (?,?,?,?,?)',[order.id,req.user.id,'PENDING','CANCELLED','Cancelled by customer']);
        await releaseCoupon(connection,order.id);
        await connection.execute("INSERT INTO notifications (user_id,type,title,body,order_id) VALUES (?,'ORDER','Đơn hàng đã hủy',?,?)",[req.user.id,`Đơn ${order.order_code} đã được hủy.`,order.id]);
        await connection.commit();return res.json({success:true,message:'Order cancelled.'});
    }catch(error){await connection.rollback();return next(error)}finally{connection.release()}
}

async function restoreStock(connection,orderId,userId){
    const [items]=await connection.execute('SELECT product_id,quantity FROM order_items WHERE order_id=? AND product_id IS NOT NULL',[orderId]);
    for(const item of items){await connection.execute('UPDATE products SET stock=stock+? WHERE id=?',[item.quantity,item.product_id]);await connection.execute("INSERT INTO inventory_movements (product_id,changed_by,quantity_delta,reason,order_id) VALUES (?,?,?,'Order cancelled; stock restored',?)",[item.product_id,userId,item.quantity,orderId])}
}

async function releaseCoupon(connection,orderId){
    const [uses]=await connection.execute('SELECT coupon_id FROM coupon_uses WHERE order_id=?',[orderId]);
    if(uses[0]){await connection.execute('UPDATE coupons SET used_count=GREATEST(used_count-1,0) WHERE id=?',[uses[0].coupon_id]);await connection.execute('DELETE FROM coupon_uses WHERE order_id=?',[orderId])}
}

module.exports={quote,create,listMine,detailMine,cancelMine,reorderMine,orderView,getOrderData,restoreStock,releaseCoupon};
