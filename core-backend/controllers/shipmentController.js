const pool = require('../config/db');
const ghn = require('../services/shipping/ghnProvider');
const { getShipmentStatusLabel } = require('../utils/shipmentStatusLabels');

function validPackage(body) {
    const values=['weightGrams','lengthCm','widthCm','heightCm'].map((key)=>Number(body?.[key]));
    return values.every(Number.isInteger)&&values[0]>0&&values[0]<20000&&values.slice(1).every((value)=>value>0&&value<=200)
        ? {weight:values[0],length:values[1],width:values[2],height:values[3]} : null;
}

function isShipmentConfigReady(config) {
    return Boolean(ghn.isConfigured(config)&&config.fromName&&config.fromPhone&&config.fromAddress&&config.fromWard&&config.fromProvince&&config.webhookSecret&&
        (config.fromIsNewAddress||config.fromDistrict));
}

function buildGhnPayload({order,address,items,packageInfo,config}) {
    const isNewToAddress=address?.isNewAdministrativeAddress===true;
    const fullAddress=[address?.addressLine,address?.ward,isNewToAddress?null:address?.district,address?.city].filter(Boolean).join(', ');
    if(!fullAddress||!address?.ward||!address?.city||(!isNewToAddress&&!address?.district))return null;
    return {
        payment_type_id:1,required_note:'KHONGCHOXEMHANG',client_order_code:order.order_code,
        from_name:config.fromName,from_phone:config.fromPhone,from_address:config.fromAddress,from_ward_name:config.fromWard,
        from_district_name:config.fromIsNewAddress?'':config.fromDistrict||'',from_province_name:config.fromProvince,is_new_from_address:config.fromIsNewAddress,
        to_name:order.recipient_name,to_phone:order.phone,to_address:fullAddress,to_ward_name:address.ward,
        to_district_name:isNewToAddress?'':address.district,to_province_name:address.city,is_new_to_address:isNewToAddress,
        weight:packageInfo.weight,length:packageInfo.length,width:packageInfo.width,height:packageInfo.height,
        service_type_id:2,cod_amount:order.payment_method==='COD'?Math.round(Number(order.total_amount)):0,
        insurance_value:Math.min(5000000,Math.round(Number(order.total_amount))),order_value:Math.round(Number(order.total_amount)),
        content:items.map((item)=>`${item.name} x${item.quantity}`).join(', ').slice(0,2000),
        items:items.map((item)=>({name:item.name,quantity:Number(item.quantity),price:Math.round(Number(item.price))}))
    };
}

async function createGhnShipment(req,res,next) {
    if(!/^\d{1,20}$/.test(String(req.params.orderId||'')))return res.status(400).json({success:false,message:'Invalid order id.'});
    const packageInfo=validPackage(req.body);if(!packageInfo)return res.status(400).json({success:false,message:'Provide valid package weight and dimensions.'});
    const config=ghn.configFromEnv();
    if(!isShipmentConfigReady(config))
        return res.status(503).json({success:false,message:'GHN staging credentials, sender address, and webhook secret are required.'});
    let order;
    let existing;
    let address;
    let items;
    const connection1=await pool.getConnection();
    try{
        await connection1.beginTransaction();
        const [[lockedOrder]]=await connection1.execute('SELECT id,order_code,status,payment_method,payment_status,total_amount,recipient_name,phone,shipping_address,shipping_carrier,tracking_number FROM orders WHERE id=? FOR UPDATE',[req.params.orderId]);
        if(!lockedOrder){await connection1.rollback();return res.status(404).json({success:false,message:'Order not found.'})}
        if(lockedOrder.status!=='PROCESSING'||(lockedOrder.payment_method==='VNPAY'&&lockedOrder.payment_status!=='PAID')){
            await connection1.rollback();
            return res.status(409).json({success:false,message:'Only a processing order that is paid or COD can be dispatched.'});
        }
        order=lockedOrder;
        let [[existingShipment]]=await connection1.execute("SELECT id,client_order_code,provider_order_code,tracking_number,status,updated_at<=NOW() - INTERVAL 5 MINUTE AS is_stale FROM shipments WHERE order_id=? AND provider='GHN' LIMIT 1 FOR UPDATE",[order.id]);
        if(existingShipment&&existingShipment.status!=='CREATING'&&existingShipment.status!=='FAILED'){
            await connection1.commit();
            return res.status(200).json({success:true,data:existingShipment});
        }
        if(existingShipment&&existingShipment.status==='CREATING'&&Number(existingShipment.is_stale)===0){
            await connection1.rollback();
            return res.status(409).json({success:false,message:'Vận đơn đang trong quá trình tạo với đơn vị vận chuyển. Vui lòng thử lại sau.'});
        }
        existing=existingShipment;
        address=typeof order.shipping_address==='string'?JSON.parse(order.shipping_address):order.shipping_address;
        const [orderItems]=await connection1.execute('SELECT product_name name,quantity,unit_price price FROM order_items WHERE order_id=? ORDER BY id',[order.id]);
        if(!orderItems.length){await connection1.rollback();return res.status(409).json({success:false,message:'Shipment cannot be created without order items.'})}
        items=orderItems;
        if(!existing){
            try{
                const [created]=await connection1.execute("INSERT INTO shipments (order_id,client_order_code,provider,status) VALUES (?,?,'GHN','CREATING')",[order.id,order.order_code]);
                existing={id:created.insertId,client_order_code:order.order_code,status:'CREATING'};
            }catch(error){
                if(error.code!=='ER_DUP_ENTRY'){await connection1.rollback();return next(error)}
                const [[dup]]=await connection1.execute("SELECT id,client_order_code,provider_order_code,tracking_number,status FROM shipments WHERE order_id=? AND provider='GHN' LIMIT 1 FOR UPDATE",[order.id]);
                existing=dup;
                if(existing&&existing.status!=='CREATING'&&existing.status!=='FAILED'){await connection1.commit();return res.json({success:true,data:existing})}
            }
        }else{
            await connection1.execute("UPDATE shipments SET status='CREATING',updated_at=NOW() WHERE id=? AND status IN ('FAILED','CREATING')",[existing.id]);
        }
        await connection1.commit();
    }catch(error){await connection1.rollback();return next(error)}finally{connection1.release()}

    const payload=buildGhnPayload({order,address,items,packageInfo,config});
    if(!payload)return res.status(409).json({success:false,message:'The saved destination address is missing the ward/province details required by GHN.'});

    let providerResult;
    try{
        providerResult=await ghn.createOrder(payload,config);
    }catch(error){
        await pool.execute("UPDATE shipments SET status='FAILED' WHERE id=? AND status='CREATING'",[existing.id]);
        return next(error);
    }

    const connection2=await pool.getConnection();
    try{
        await connection2.beginTransaction();
        const [[current]]=await connection2.execute('SELECT id,status,shipping_carrier,tracking_number FROM orders WHERE id=? FOR UPDATE',[order.id]);
        if(!current||current.status!=='PROCESSING'){
            let cancelOk=false;
            let cancelError=null;
            try{
                if(typeof ghn.cancelOrder==='function'){
                    cancelOk=await ghn.cancelOrder({orderCodes:[providerResult.orderCode]},config);
                }
            }catch(cancelErr){
                cancelError=cancelErr;
                console.warn('Could not auto-cancel GHN order on provider:',cancelErr.message);
            }
            await connection2.execute("UPDATE shipments SET provider_order_code=?,tracking_number=?,status='CANCELLED' WHERE id=?",[providerResult.orderCode,providerResult.orderCode,existing.id]);
            const auditAction=cancelOk?'SHIPMENT_ABORTED':'SHIPMENT_CANCEL_FAILED';
            const auditDetails={
                provider:'GHN',
                trackingNumber:providerResult.orderCode,
                orderStatus:current?.status||'UNKNOWN',
                autoCancelSuccess:Boolean(cancelOk),
                error:cancelError?cancelError.message:null,
                manualActionRequired:!cancelOk
            };
            await connection2.execute('INSERT INTO admin_audit_logs (admin_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,CAST(? AS JSON))',[req.user.id,auditAction,'order',order.id,JSON.stringify(auditDetails)]);
            const historyNote=cancelOk
                ?`Đơn hàng đã đổi trạng thái (${current?.status||'CANCELLED'}). Vận đơn GHN đã được tự động hủy.`
                :`Đơn hàng đã đổi trạng thái (${current?.status||'CANCELLED'}) nhưng tự động hủy GHN thất bại: ${cancelError?.message||'Lỗi không xác định'}. Cần hủy thủ công trên portal GHN.`;
            await connection2.execute('INSERT INTO order_shipping_history (order_id,changed_by,carrier,tracking_number,note) VALUES (?,?,\'GHN\',?,?)',[order.id,req.user.id,providerResult.orderCode,historyNote]);
            await connection2.commit();
            return res.status(409).json({
                success:false,
                message:'Order status changed while creating the shipment. GHN shipment was aborted.',
                manualActionRequired:!cancelOk
            });
        }
        await connection2.execute("UPDATE shipments SET provider_order_code=?,tracking_number=?,status=IF(status='CREATING','CREATED',status) WHERE id=?",[providerResult.orderCode,providerResult.orderCode,existing.id]);
        if(current.shipping_carrier!=='GHN'||current.tracking_number!==providerResult.orderCode){
            await connection2.execute("UPDATE orders SET shipping_carrier='GHN',tracking_number=? WHERE id=?",[providerResult.orderCode,order.id]);
            await connection2.execute('INSERT INTO order_shipping_history (order_id,changed_by,carrier,tracking_number,note) VALUES (?,? ,\'GHN\',?,?)',[order.id,req.user.id,providerResult.orderCode,`Shipment created in GHN ${config.environment} environment.`]);
            await connection2.execute('INSERT INTO admin_audit_logs (admin_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,CAST(? AS JSON))',[req.user.id,'SHIPMENT_CREATE','order',order.id,JSON.stringify({provider:'GHN',environment:config.environment,trackingNumber:providerResult.orderCode})]);
        }
        await connection2.commit();
        const [[shipment]]=await pool.execute('SELECT provider_order_code,tracking_number,status FROM shipments WHERE id=?',[existing.id]);
        return res.status(201).json({success:true,data:{provider:'GHN',trackingNumber:shipment.tracking_number,status:shipment.status,estimatedDeliveryAt:providerResult.expectedDeliveryTime,fee:providerResult.totalFee}});
    }catch(error){await connection2.rollback();if(error.code==='ER_DUP_ENTRY'){const [[saved]]=await pool.execute("SELECT provider_order_code trackingNumber,status FROM shipments WHERE order_id=? AND provider='GHN'",[order.id]);if(saved)return res.json({success:true,data:saved})}return next(error)}finally{connection2.release()}
}

function webhookSecretValid(req,config) {
    return ghn.safeSecretEqual(req.get('x-giftly-shipping-secret'),config.webhookSecret);
}

async function ghnWebhook(req,res,next) {
    const config=ghn.configFromEnv();
    if(!config.shopId||!config.webhookSecret||!webhookSecretValid(req,config))return res.status(401).json({success:false,message:'Invalid webhook credentials.'});
    const event=req.body||{};const key=ghn.webhookEventKey(event);const status=ghn.normalizeStatus(event.Status);
    if(!key||!status||!event.OrderCode||String(event.ShopID)!==String(config.shopId))return res.json({success:true,ignored:true});
    const connection=await pool.getConnection();
    try{
        await connection.beginTransaction();
        const [[shipment]]=await connection.execute("SELECT id,order_id,status,DATE_FORMAT(last_event_at,'%Y-%m-%dT%H:%i:%sZ') last_event_at FROM shipments WHERE provider='GHN' AND (provider_order_code=? OR client_order_code=?) ORDER BY (provider_order_code=?) DESC LIMIT 1 FOR UPDATE",[event.OrderCode,String(event.ClientOrderCode||''),event.OrderCode]);
        if(!shipment){await connection.rollback();return res.json({success:true,ignored:true})}
        const occurredAt=new Date(event.Time);const occurredSql=occurredAt.toISOString().slice(0,19).replace('T',' ');
        await connection.execute('UPDATE shipments SET provider_order_code=COALESCE(provider_order_code,?),tracking_number=COALESCE(tracking_number,?) WHERE id=?',[event.OrderCode,event.OrderCode,shipment.id]);
        await connection.execute('INSERT INTO shipment_events (shipment_id,provider_event_key,event_type,provider_status,normalized_status,occurred_at) VALUES (?,?,?,?,?,?)',[shipment.id,key,String(event.Type).slice(0,40),String(event.Status).slice(0,80),status,occurredSql]);
        const previous=shipment.last_event_at?Date.parse(shipment.last_event_at):0;
        if(occurredAt.getTime()>previous&&ghn.canTransitionShipment(shipment.status,status)){
            await connection.execute('UPDATE shipments SET status=?,last_event_at=? WHERE id=?',[status,occurredSql,shipment.id]);
            const [[order]]=await connection.execute('SELECT id,user_id,order_code,status,payment_method FROM orders WHERE id=? FOR UPDATE',[shipment.order_id]);
            let nextStatus=null;
            if(['PICKING','PICKED_UP','IN_TRANSIT','OUT_FOR_DELIVERY'].includes(status)&&order.status==='PROCESSING')nextStatus='SHIPPED';
            if(status==='DELIVERED'&&['PROCESSING','SHIPPED'].includes(order.status))nextStatus='DELIVERED';
            if(nextStatus){
                if(nextStatus==='DELIVERED'&&order.status==='PROCESSING')await connection.execute('INSERT INTO order_status_history (order_id,changed_by,from_status,to_status,note) VALUES (?,NULL,\'PROCESSING\',\'SHIPPED\',\'Đơn vị vận chuyển đã lấy hàng\')',[order.id]);
                await connection.execute('UPDATE orders SET status=?,payment_status=IF(?=\'DELIVERED\' AND payment_method=\'COD\',\'PAID\',payment_status) WHERE id=?',[nextStatus,nextStatus,order.id]);
                await connection.execute('INSERT INTO order_status_history (order_id,changed_by,from_status,to_status,note) VALUES (?,NULL,?,?,?)',[order.id,order.status,nextStatus,`Cập nhật vận đơn GHN: ${getShipmentStatusLabel(status)}`]);
                await connection.execute("INSERT INTO notifications (user_id,type,title,body,order_id) VALUES (?,'SHIPPING',?,?,?)",[order.user_id,`Cập nhật đơn ${order.order_code}`,`Đơn vận chuyển GHN: ${getShipmentStatusLabel(status)}.`,order.id]);
            }
        }
        await connection.commit();return res.json({success:true,accepted:true});
    }catch(error){
        await connection.rollback();
        if(error.code==='ER_DUP_ENTRY')return res.json({success:true,duplicate:true});
        return next(error);
    }finally{connection.release()}
}

module.exports={createGhnShipment,ghnWebhook,validPackage,buildGhnPayload,isShipmentConfigReady};
