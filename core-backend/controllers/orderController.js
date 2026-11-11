const crypto = require('node:crypto');
const pool = require('../config/db');
const vnpay = require('../services/payments/vnpay');
const { calculateReorderItems } = require('../utils/cartHelper');
const { canCustomerCancel, parseCreateOrderBody } = require('../utils/orderContract');

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
    const [items] = await connection.execute(`SELECT ci.product_id,ci.quantity,p.name,p.image_url,p.price,p.stock,p.status,p.is_synthetic_display,p.category_id,c.name category_name
        FROM cart_items ci LEFT JOIN products p ON p.id=ci.product_id LEFT JOIN categories c ON c.id=p.category_id
        WHERE ci.user_id=? AND ci.is_selected=1 ${lock ? 'FOR UPDATE' : ''}`, [userId]);
    if (!items.length) return { error:'Select at least one product from your cart.' };
    const syntheticItem = items.find((item) => item.is_synthetic_display);
    if (syntheticItem) {
        return {
            error: `Sản phẩm "${syntheticItem.name || 'trong giỏ'}" là sản phẩm mẫu thử nghiệm, không hỗ trợ đặt hàng.`,
            data: { productId: syntheticItem.product_id }
        };
    }
    const unavailableItem = items.find((item) => !item.name || item.status !== 'ACTIVE');
    if (unavailableItem) {
        return {
            error: `Sản phẩm "${unavailableItem.name || 'trong giỏ'}" hiện không còn kinh doanh hoặc đã ngừng hoạt động.`,
            data: { productId: unavailableItem.product_id }
        };
    }
    const outOfStockItem = items.find((item) => Number(item.quantity) > Number(item.stock));
    if (outOfStockItem) {
        return {
            error: `Sản phẩm "${outOfStockItem.name}" chỉ còn ${outOfStockItem.stock} trong kho (bạn đặt ${outOfStockItem.quantity}). Vui lòng cập nhật số lượng giỏ hàng.`,
            data: {
                productId: outOfStockItem.product_id,
                available: Number(outOfStockItem.stock),
                requested: Number(outOfStockItem.quantity)
            }
        };
    }
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
        if (totals.error) return res.status(400).json({ success:false,message:totals.error,data:totals.data });
        return res.json({ success:true,data:{ subtotal:amount(totals.subtotalCents),discount:amount(totals.discountCents),discountEligibleSubtotal:totals.discountBaseCents==null?null:amount(totals.discountBaseCents),coupon:totals.coupon?{code:totals.coupon.code,categoryNames:totals.eligibleCategoryNames}:null,shippingMethod:totals.shippingMethod,shippingFee:amount(totals.shippingCents),shippingOptions:totals.shippingOptions.map((option)=>({method:option.method,fee:amount(option.feeCents),free:option.free})),total:amount(totals.totalCents),paymentMethod:'COD' } });
    } catch (error) { return next(error); }
    finally { connection.release(); }
}

async function create(req, res, next) {
    const parsed = parseCreateOrderBody(req.body, req.get('Idempotency-Key'));
    if (!parsed.ok) {
        return res.status(parsed.status).json({ success: false, message: parsed.message });
    }
    const { addressId, couponCode, note, shippingMethod, paymentMethod, idempotencyKey: requestKey } = parsed;
    if (paymentMethod === 'VNPAY' && !vnpay.isConfigured()) return res.status(503).json({ success: false, message: 'Online payment is not configured for this environment.' });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        if(requestKey){
            // This is a read-only idempotency lookup. Locking a missing unique-key range
            // can deadlock unrelated checkouts that are reserving the same product.
            // The unique index and ER_DUP_ENTRY recovery below serialize same-key retries.
            const [existing]=await connection.execute('SELECT id,order_code,status,total_amount,shipping_method,payment_method FROM orders WHERE user_id=? AND idempotency_key=? LIMIT 1',[req.user.id,requestKey]);
            if(existing[0]){await connection.commit();return res.status(200).json({success:true,message:'This checkout request was already processed.',data:{orderId:String(existing[0].id),orderCode:existing[0].order_code,status:existing[0].status,paymentMethod:existing[0].payment_method,shippingMethod:existing[0].shipping_method||'STANDARD',total:Number(existing[0].total_amount)}})}
        }
        const totals = await quoteTotals(connection,req.user.id,addressId,couponCode,true,shippingMethod);
        if (totals.error) { await connection.rollback(); return res.status(409).json({ success:false,message:totals.error,data:totals.data }); }
        const orderCode = `GL${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const address = totals.address;
        const initialStatus = paymentMethod === 'COD' ? 'CONFIRMED' : 'PENDING';
        const isSimulated = Boolean(req.body?.isSimulated || req.headers?.['x-simulated'] === 'true');
        const [created] = await connection.execute(`INSERT INTO orders
            (order_code,idempotency_key,user_id,status,payment_method,shipping_method,payment_status,recipient_name,phone,shipping_address,customer_note,coupon_code,subtotal,discount_amount,shipping_fee,total_amount,is_simulated)
            VALUES (?,?,?,?,?,?, 'UNPAID',?,?,?,?,?,?,?,?,?,?)`,
            [orderCode,requestKey,req.user.id,initialStatus,paymentMethod,totals.shippingMethod,address.recipient_name,address.phone,JSON.stringify({ addressLine:address.address_line,ward:address.ward,district:address.district,city:address.city,isNewAdministrativeAddress:Boolean(address.is_new_administrative_address) }),note,totals.coupon?.code || null,amount(totals.subtotalCents),amount(totals.discountCents),amount(totals.shippingCents),amount(totals.totalCents), isSimulated ? 1 : 0]);
        const orderId = created.insertId;
        await connection.execute('INSERT INTO order_status_history (order_id,changed_by,to_status,note,source) VALUES (?,?,?,?,\'CUSTOMER\')', [orderId,req.user.id,initialStatus,'Khách đặt hàng']);
        const sortedItems = [...totals.items].sort((a, b) => Number(a.product_id) - Number(b.product_id));
        for (const item of sortedItems) {
            const [updated] = await connection.execute("UPDATE products SET stock=stock-? WHERE id=? AND status='ACTIVE' AND (is_synthetic_display = FALSE OR is_synthetic_display IS NULL) AND stock>=?", [item.quantity,item.product_id,item.quantity]);
            if (updated.affectedRows !== 1) {
                const [freshProducts] = await connection.execute('SELECT name, stock, status, is_synthetic_display FROM products WHERE id=?', [item.product_id]);
                const fresh = freshProducts[0];
                if (!fresh || fresh.status !== 'ACTIVE') {
                    throw Object.assign(new Error(`Sản phẩm "${item.name}" hiện không còn kinh doanh.`), { httpStatus: 409 });
                }
                if (fresh.is_synthetic_display) {
                    throw Object.assign(new Error(`Sản phẩm "${item.name}" là sản phẩm mẫu thử nghiệm, không thể đặt hàng.`), { httpStatus: 400 });
                }
                throw Object.assign(
                    new Error(`Sản phẩm "${item.name}" chỉ còn ${fresh.stock} trong kho (bạn đặt ${item.quantity}). Vui lòng cập nhật lại giỏ hàng.`),
                    {
                        httpStatus: 409,
                        data: {
                            productId: item.product_id,
                            available: Number(fresh.stock),
                            requested: Number(item.quantity)
                        }
                    }
                );
            }
            await connection.execute('INSERT INTO order_items (order_id,product_id,product_name,image_url,unit_price,quantity,line_total) VALUES (?,?,?,?,?,?,?)',
                [orderId,item.product_id,item.name,item.image_url,Number(item.price),item.quantity,amount(cents(item.price)*Number(item.quantity))]);
            await connection.execute('INSERT INTO inventory_movements (product_id,changed_by,quantity_delta,reason,order_id) VALUES (?,?,?,\'Đơn hàng của khách\',?)', [item.product_id,req.user.id,-Number(item.quantity),orderId]);
            await connection.execute("INSERT INTO product_events (user_id,product_id,event_type,is_simulated) VALUES (?,?,'PURCHASE',?)", [req.user.id,item.product_id, isSimulated ? 1 : 0]);
        }
        if (totals.coupon) {
            await connection.execute('UPDATE coupons SET used_count=used_count+1 WHERE id=?', [totals.coupon.id]);
            await connection.execute('INSERT INTO coupon_uses (coupon_id,user_id,order_id,discount_amount) VALUES (?,?,?,?)', [totals.coupon.id,req.user.id,orderId,amount(totals.discountCents)]);
        }
        let finalStatus = initialStatus;
        if (paymentMethod === 'COD') {
            finalStatus = 'PROCESSING';
            await connection.execute("UPDATE orders SET status='PROCESSING' WHERE id=?", [orderId]);
            await connection.execute("INSERT INTO order_status_history (order_id,changed_by,from_status,to_status,note,source) VALUES (?,NULL,'CONFIRMED','PROCESSING','Đã giữ hàng, tự động chuyển sang chuẩn bị hàng','SYSTEM')", [orderId]);
        }
        await connection.execute('DELETE FROM cart_items WHERE user_id=? AND is_selected=1', [req.user.id]);
        await connection.execute("INSERT INTO notifications (user_id,type,title,body,order_id) VALUES (?,'ORDER','Đặt hàng thành công',?,?)", [req.user.id,`Đơn ${orderCode} đã được ghi nhận. Phương thức thanh toán: ${paymentMethod}.`,orderId]);
        await connection.commit();
        return res.status(201).json({ success:true,message:'Order placed.',data:{ orderId:String(orderId),orderCode,status:finalStatus,paymentMethod,shippingMethod:totals.shippingMethod,total:amount(totals.totalCents) } });
    } catch (error) {
        await connection.rollback();
        if(error.code==='ER_DUP_ENTRY'&&requestKey){
            try{const [[existing]]=await pool.execute('SELECT id,order_code,status,total_amount,shipping_method,payment_method FROM orders WHERE user_id=? AND idempotency_key=? LIMIT 1',[req.user.id,requestKey]);if(existing)return res.status(200).json({success:true,message:'This checkout request was already processed.',data:{orderId:String(existing.id),orderCode:existing.order_code,status:existing.status,paymentMethod:existing.payment_method,shippingMethod:existing.shipping_method||'STANDARD',total:Number(existing.total_amount)}})}catch(readError){return next(readError)}
        }
        if (error.httpStatus) return res.status(error.httpStatus).json({ success:false,message:error.message,data:error.data });
        return next(error);
    } finally { connection.release(); }
}

function positiveDays(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value >= 1 && value <= 365 ? value : fallback;
}
const returnWindowDays = positiveDays('RETURN_WINDOW_DAYS', 7);
const autoReceiveDays = returnWindowDays;
const orderSelect = `SELECT o.*, DATE_ADD(o.delivered_at, INTERVAL ${autoReceiveDays} DAY) auto_received_at,
    DATE_ADD(o.delivered_at, INTERVAL ${returnWindowDays} DAY) return_deadline,
    (SELECT s.provider FROM shipments s WHERE s.order_id=o.id LIMIT 1) delivery_source,
    (SELECT u.full_name FROM users u WHERE u.id=o.shipper_user_id LIMIT 1) shipper_name,
    (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id) item_count FROM orders o`;

const activeReorders = new Map();

function shouldDebounceReorder(key) {
    const now = Date.now();
    const last = activeReorders.get(key);
    if (last && now - last < 2000) return true;
    activeReorders.set(key, now);
    setTimeout(() => {
        if (activeReorders.get(key) === now) activeReorders.delete(key);
    }, 5000).unref?.();
    return false;
}

async function reorderMine(req,res,next){
    if(!/^\d+$/.test(String(req.params.id||'')))return res.status(400).json({success:false,message:'Mã đơn hàng không hợp lệ.'});
    const reorderKey = `${req.user.id}:${req.params.id}`;
    if(shouldDebounceReorder(reorderKey)){
        return res.status(429).json({success:false,message:'Yêu cầu mua lại đang được xử lý, vui lòng chờ trong giây lát.'});
    }
    const connection=await pool.getConnection();
    try{
        await connection.beginTransaction();
        const [orders]=await connection.execute('SELECT id FROM orders WHERE id=? AND user_id=? FOR UPDATE',[req.params.id,req.user.id]);
        if(!orders[0]){await connection.rollback();return res.status(404).json({success:false,message:'Không tìm thấy đơn hàng.'})}
        const [orderItems]=await connection.execute('SELECT product_id,product_name,quantity FROM order_items WHERE order_id=? ORDER BY id',[orders[0].id]);
        if(!orderItems.length){await connection.rollback();return res.status(409).json({success:false,message:'Đơn hàng này không có sản phẩm để mua lại.'})}
        const validIds=[...new Set(orderItems.filter(item=>item.product_id!=null).map(item=>String(item.product_id)))];
        let products=[];
        let cartRows=[];
        if(validIds.length>0){
            const [pRows]=await connection.execute(`SELECT id,name,stock,status,price,is_synthetic_display FROM products WHERE id IN (${validIds.map(()=>'?').join(',')}) ORDER BY id FOR UPDATE`,validIds);
            products=pRows;
            const [cRows]=await connection.execute(`SELECT product_id,quantity FROM cart_items WHERE user_id=? AND product_id IN (${validIds.map(()=>'?').join(',')}) FOR UPDATE`,[req.user.id,...validIds]);
            cartRows=cRows;
        }
        const { addedItems, skippedItems } = calculateReorderItems({ orderItems, products, cartItems: cartRows });
        if(addedItems.length===0){
            await connection.rollback();
            return res.status(409).json({
                success:false,
                message:'Không thể thêm sản phẩm nào vào giỏ hàng do đã hết hàng hoặc ngừng kinh doanh.',
                data:{ addedItems:[], skippedItems }
            });
        }
        for(const item of addedItems){
            await connection.execute('INSERT INTO cart_items (user_id,product_id,quantity,is_selected) VALUES (?,?,?,TRUE) ON DUPLICATE KEY UPDATE quantity=VALUES(quantity),is_selected=TRUE',[req.user.id,item.productId,item.targetInCart]);
            await connection.execute("INSERT INTO product_events (user_id,product_id,event_type) VALUES (?,?,'CART_ADD')",[req.user.id,item.productId]);
        }
        await connection.commit();
        let message=`Đã thêm ${addedItems.length} sản phẩm từ đơn hàng vào giỏ hàng.`;
        if(skippedItems.length>0){
            message+=` (Có ${skippedItems.length} sản phẩm không thể thêm do hết hàng hoặc ngừng kinh doanh).`;
        }
        return res.json({
            success:true,
            message,
            data:{
                addedItems,
                skippedItems,
                addedCount:addedItems.length,
                skippedCount:skippedItems.length
            }
        });
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
    const deliveredAt = row.delivered_at || null;
    const autoReceivedAt = row.auto_received_at || null;
    const automaticallyReceived = Boolean(autoReceivedAt && new Date(autoReceivedAt) <= new Date());
    const receiptAt = row.received_confirmed_at || (automaticallyReceived ? autoReceivedAt : null);
    return { id:String(row.id),orderCode:row.order_code,status:row.status,paymentMethod:row.payment_method,shippingMethod:row.shipping_method||'STANDARD',paymentStatus:row.payment_status,
        recipientName:row.recipient_name,phone:row.phone,shippingAddress:row.shipping_address,customerNote:row.customer_note,couponCode:row.coupon_code,
        shippingCarrier:row.shipping_carrier||null,trackingNumber:row.tracking_number||null,
        deliverySource:row.delivery_source||null,shipperUserId:row.shipper_user_id==null?null:String(row.shipper_user_id),shipperName:row.shipper_name||null,
        subtotal:Number(row.subtotal),discount:Number(row.discount_amount),shippingFee:Number(row.shipping_fee),total:Number(row.total_amount),
        deliveredAt,receivedConfirmedAt:row.received_confirmed_at||null,receivedAt:receiptAt,
        canConfirmReceived:row.status==='DELIVERED'&&Boolean(deliveredAt)&&!row.received_confirmed_at&&!automaticallyReceived,
        returnDeadline:row.return_deadline||null,returnWindowOpen:row.status==='DELIVERED'&&Boolean(deliveredAt)&&Boolean(row.return_deadline)&&new Date(row.return_deadline)>=new Date(),
        createdAt:row.created_at,updatedAt:row.updated_at,itemCount:Number(row.item_count || 0),items,history,shippingHistory:shippingHistory||[] };
}

async function getOrderData(connection, orderId, whereClause, params) {
    const [orders]=await connection.execute(`${orderSelect} WHERE ${whereClause} LIMIT 1`,params);
    if(!orders[0])return null;
    const [items]=await connection.execute('SELECT id,product_id,product_name,image_url,unit_price,quantity,line_total FROM order_items WHERE order_id=? ORDER BY id',[orderId]);
    const [history]=await connection.execute('SELECT h.from_status,h.to_status,h.note,h.source,h.changed_by,u.full_name changed_by_name,h.created_at FROM order_status_history h LEFT JOIN users u ON u.id=h.changed_by WHERE h.order_id=? ORDER BY h.created_at,h.id',[orderId]);
    const [shippingHistory]=await connection.execute('SELECT carrier,tracking_number,note,created_at FROM order_shipping_history WHERE order_id=? ORDER BY created_at,id',[orderId]);
    const [shipmentEvents]=await connection.execute(`SELECT s.provider,s.tracking_number,e.provider_status,e.normalized_status,
        DATE_FORMAT(e.occurred_at,'%Y-%m-%dT%H:%i:%sZ') occurred_at
        FROM shipments s JOIN shipment_events e ON e.shipment_id=s.id WHERE s.order_id=? ORDER BY e.occurred_at,e.id`,[orderId]);
    const unifiedShippingHistory=[
        ...shippingHistory.map((row)=>({carrier:row.carrier,trackingNumber:row.tracking_number,note:row.note,createdAt:row.created_at})),
        ...shipmentEvents.map((row)=>({carrier:row.provider,trackingNumber:row.tracking_number,note:`${row.provider_status||'Status update'} · ${row.normalized_status}`,createdAt:row.occurred_at}))
    ].sort((left,right)=>new Date(left.createdAt)-new Date(right.createdAt));
    return orderView(orders[0],items.map((row)=>({id:String(row.id),productId:row.product_id==null?null:String(row.product_id),name:row.product_name,imageUrl:row.image_url,unitPrice:Number(row.unit_price),quantity:Number(row.quantity),lineTotal:Number(row.line_total)})),history,unifiedShippingHistory);
}

async function detailMine(req,res,next){
    try{const order=await getOrderData(pool,req.params.id,'o.id=? AND o.user_id=?',[req.params.id,req.user.id]);if(!order)return res.status(404).json({success:false,message:'Order not found.'});return res.json({success:true,data:order})}catch(error){return next(error)}
}

async function confirmReceived(req,res,next){
    if(!/^\d+$/.test(String(req.params.id||'')))return res.status(400).json({success:false,message:'Invalid order id.'});
    const connection=await pool.getConnection();
    try{
        await connection.beginTransaction();
        const [[order]]=await connection.execute(`SELECT id,status,delivered_at,received_confirmed_at,
            DATE_ADD(delivered_at, INTERVAL ${autoReceiveDays} DAY) auto_received_at
            FROM orders WHERE id=? AND user_id=? FOR UPDATE`,[req.params.id,req.user.id]);
        if(!order){await connection.rollback();return res.status(404).json({success:false,message:'Order not found.'})}
        if(order.status!=='DELIVERED'||!order.delivered_at){await connection.rollback();return res.status(409).json({success:false,message:'Only delivered orders can be confirmed as received.'})}
        if(order.received_confirmed_at){await connection.commit();return res.json({success:true,data:{receivedConfirmedAt:order.received_confirmed_at,alreadyConfirmed:true}})}
        if(new Date(order.auto_received_at)<=new Date()){
            await connection.commit();
            return res.json({success:true,data:{receivedConfirmedAt:null,receivedAt:order.auto_received_at,automaticallyConfirmed:true}});
        }
        await connection.execute('UPDATE orders SET received_confirmed_at=NOW() WHERE id=? AND received_confirmed_at IS NULL',[order.id]);
        await connection.commit();
        const [[saved]]=await pool.execute('SELECT received_confirmed_at FROM orders WHERE id=?',[order.id]);
        return res.json({success:true,data:{receivedConfirmedAt:saved.received_confirmed_at,automaticallyConfirmed:false}});
    }catch(error){await connection.rollback();return next(error)}finally{connection.release()}
}

async function cancelMine(req,res,next){
    const connection=await pool.getConnection();
    try{
        await connection.beginTransaction();
        const [orders]=await connection.execute('SELECT * FROM orders WHERE id=? AND user_id=? FOR UPDATE',[req.params.id,req.user.id]);
        const order=orders[0];if(!order){await connection.rollback();return res.status(404).json({success:false,message:'Order not found.'})}
        const check=canCustomerCancel(order);
        if(!check.canCancel){await connection.rollback();return res.status(check.status).json({success:false,message:check.message})}
        if (order.shipping_carrier) {
            await connection.rollback();
            return res.status(409).json({success:false,message:'Đơn hàng đã được bàn giao cho đơn vị vận chuyển, không thể tự hủy.'});
        }
        const [[activeShipment]] = await connection.execute(
            "SELECT id,status,updated_at<=NOW() - INTERVAL 5 MINUTE AS is_stale FROM shipments WHERE order_id=? AND status NOT IN ('FAILED','CANCELLED') LIMIT 1",
            [order.id]
        );
        if (activeShipment) {
            if (activeShipment.status === 'CREATING' && Number(activeShipment.is_stale) === 1) {
                await connection.execute("UPDATE shipments SET status='FAILED' WHERE id=?", [activeShipment.id]);
                await connection.execute('INSERT INTO order_shipping_history (order_id,changed_by,carrier,tracking_number,note) VALUES (?,?,?,?,?)',
                    [order.id, req.user.id, 'GHN', 'N/A', 'Vận đơn CREATING kẹt quá 5 phút đã hết hạn, tự động đánh dấu FAILED']);
            } else {
                await connection.rollback();
                return res.status(409).json({success:false,message:'Đơn hàng đã được bàn giao cho đơn vị vận chuyển, không thể tự hủy.'});
            }
        }
        await restoreStock(connection,order.id,req.user.id);
        await connection.execute("UPDATE orders SET status='CANCELLED' WHERE id=?",[order.id]);
        await connection.execute('INSERT INTO order_status_history (order_id,changed_by,from_status,to_status,note,source) VALUES (?,?,?,?,?,\'CUSTOMER\')',[order.id,req.user.id,check.fromStatus,'CANCELLED','Khách hủy đơn']);
        await releaseCoupon(connection,order.id);
        await connection.execute("UPDATE payment_attempts SET status='EXPIRED' WHERE order_id=? AND status='PENDING'",[order.id]);
        await connection.execute("INSERT INTO notifications (user_id,type,title,body,order_id) VALUES (?,'ORDER','Đơn hàng đã hủy',?,?)",[req.user.id,`Đơn ${order.order_code} đã được hủy.`,order.id]);
        await connection.commit();return res.json({success:true,message:'Order cancelled.'});
    }catch(error){await connection.rollback();return next(error)}finally{connection.release()}
}

async function restoreStock(connection,orderId,userId){
    const [items]=await connection.execute('SELECT product_id,quantity FROM order_items WHERE order_id=? AND product_id IS NOT NULL ORDER BY product_id ASC',[orderId]);
    for(const item of items){await connection.execute('UPDATE products SET stock=stock+? WHERE id=?',[item.quantity,item.product_id]);await connection.execute("INSERT INTO inventory_movements (product_id,changed_by,quantity_delta,reason,order_id) VALUES (?,?,?,'Hủy đơn; hoàn tồn kho',?)",[item.product_id,userId,item.quantity,orderId])}
}

async function releaseCoupon(connection,orderId){
    const [uses]=await connection.execute('SELECT coupon_id FROM coupon_uses WHERE order_id=?',[orderId]);
    if(uses[0]){await connection.execute('UPDATE coupons SET used_count=GREATEST(used_count-1,0) WHERE id=?',[uses[0].coupon_id]);await connection.execute('DELETE FROM coupon_uses WHERE order_id=?',[orderId])}
}

module.exports={quote,create,listMine,detailMine,confirmReceived,cancelMine,reorderMine,orderView,getOrderData,restoreStock,releaseCoupon};
