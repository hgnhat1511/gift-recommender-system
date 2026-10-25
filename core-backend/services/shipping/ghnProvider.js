const crypto = require('node:crypto');

const ENDPOINTS = {
    staging: 'https://dev-online-gateway.ghn.vn/shiip/public-api',
    production: 'https://online-gateway.ghn.vn/shiip/public-api'
};
const STATUS_MAP = {
    ready_to_pick:'READY_FOR_PICKUP', picking:'PICKING', picked:'PICKED_UP', storing:'IN_TRANSIT',
    transporting:'IN_TRANSIT', sorting:'IN_TRANSIT', delivering:'OUT_FOR_DELIVERY', delivered:'DELIVERED',
    delivery_fail:'DELIVERY_FAILED', waiting_to_return:'RETURNING', return:'RETURNING', returned:'RETURNED',
    return_fail:'RETURN_FAILED', cancel:'CANCELLED', exception:'ISSUE', damage:'ISSUE', lost:'ISSUE'
};
const SHIPMENT_TRANSITIONS = {
    READY_FOR_PICKUP:['PICKING','PICKED_UP','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED','RETURNING','CANCELLED','ISSUE'],
    PICKING:['PICKED_UP','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED','RETURNING','CANCELLED','ISSUE'],
    PICKED_UP:['IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED','RETURNING','CANCELLED','ISSUE'],
    IN_TRANSIT:['OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED','RETURNING','CANCELLED','ISSUE'],
    OUT_FOR_DELIVERY:['DELIVERED','DELIVERY_FAILED','RETURNING','ISSUE'],
    DELIVERY_FAILED:['PICKING','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','RETURNING','RETURN_FAILED','ISSUE'],
    RETURNING:['RETURNED','RETURN_FAILED','ISSUE'],
    RETURN_FAILED:['RETURNING','RETURNED','ISSUE'],
    ISSUE:['PICKING','PICKED_UP','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED','RETURNING','RETURN_FAILED'],
    DELIVERED:['RETURNING'],RETURNED:[],CANCELLED:[]
};

function configFromEnv(env=process.env) {
    const environment=env.GHN_ENVIRONMENT==='production'?'production':'staging';
    return {environment,baseUrl:ENDPOINTS[environment],token:env.GHN_TOKEN,shopId:env.GHN_SHOP_ID,webhookSecret:env.GHN_WEBHOOK_SECRET,
        fromName:env.GHN_FROM_NAME,fromPhone:env.GHN_FROM_PHONE,fromAddress:env.GHN_FROM_ADDRESS,fromWard:env.GHN_FROM_WARD,
        fromDistrict:env.GHN_FROM_DISTRICT,fromProvince:env.GHN_FROM_PROVINCE,fromIsNewAddress:env.GHN_FROM_IS_NEW_ADDRESS==='true'};
}

function isConfigured(config=configFromEnv()) { return Boolean(config.token&&config.shopId); }

function safeSecretEqual(received,expected) {
    if(typeof received!=='string'||typeof expected!=='string'||!received||!expected)return false;
    const left=Buffer.from(received,'utf8');const right=Buffer.from(expected,'utf8');
    return left.length===right.length&&crypto.timingSafeEqual(left,right);
}

function normalizeStatus(value) { return STATUS_MAP[String(value||'').trim().toLowerCase()]||null; }

function canTransitionShipment(current,next) {
    if(current===next)return true;
    if(['CREATING','CREATED','PENDING','FAILED'].includes(current))return true;
    return Boolean(SHIPMENT_TRANSITIONS[current]?.includes(next));
}

function webhookEventKey(payload) {
    if(!payload||typeof payload.OrderCode!=='string'||typeof payload.Type!=='string'||typeof payload.Time!=='string')return null;
    const timestamp=Date.parse(payload.Time);
    if(!Number.isFinite(timestamp))return null;
    return `${payload.OrderCode}:${payload.Type}:${new Date(timestamp).toISOString()}`.slice(0,190);
}

async function createOrder(payload, config=configFromEnv(), fetchImpl=fetch) {
    if(!isConfigured(config))throw new Error('GHN staging credentials are not configured.');
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8000);
    try {
        const response=await fetchImpl(`${config.baseUrl}/v2/shipping-order/create`,{
            method:'POST',headers:{'content-type':'application/json',Token:config.token,ShopId:String(config.shopId)},
            body:JSON.stringify(payload),signal:controller.signal
        });
        if(!response.ok)throw new Error('GHN provider request failed.');
        const body=await response.json();
        if(body?.code!==200||typeof body?.data?.order_code!=='string')throw new Error('GHN could not create the shipment.');
        return {orderCode:body.data.order_code,totalFee:Number(body.data.total_fee)||0,expectedDeliveryTime:body.data.expected_delivery_time||null};
    }finally{clearTimeout(timer)}
}

module.exports={ENDPOINTS,STATUS_MAP,configFromEnv,isConfigured,safeSecretEqual,normalizeStatus,canTransitionShipment,webhookEventKey,createOrder};
