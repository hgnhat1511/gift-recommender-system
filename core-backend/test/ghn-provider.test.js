const test = require('node:test');
const assert = require('node:assert/strict');
const { ENDPOINTS,configFromEnv,isConfigured,safeSecretEqual,normalizeStatus,canTransitionShipment,webhookEventKey,createOrder,cancelOrder } = require('../services/shipping/ghnProvider');
const { buildGhnPayload,isShipmentConfigReady } = require('../controllers/shipmentController');

test('GHN configuration only selects the pinned staging/production endpoints',()=>{
    assert.equal(configFromEnv({GHN_ENVIRONMENT:'production'}).baseUrl,ENDPOINTS.production);
    assert.equal(configFromEnv({GHN_ENVIRONMENT:'other'}).baseUrl,ENDPOINTS.staging);
    assert.equal(isConfigured(configFromEnv({GHN_TOKEN:'token',GHN_SHOP_ID:'12'})),true);
    assert.equal(isConfigured(configFromEnv({GHN_TOKEN:'token'})),false);
});

test('webhook shared-secret comparison and GHN state normalization are strict',()=>{
    assert.equal(safeSecretEqual('shared-local-secret','shared-local-secret'),true);
    assert.equal(safeSecretEqual('shared-local-secret','different'),false);
    assert.equal(safeSecretEqual(undefined,'shared-local-secret'),false);
    assert.equal(normalizeStatus('delivering'),'OUT_FOR_DELIVERY');
    assert.equal(normalizeStatus('delivered'),'DELIVERED');
    assert.equal(normalizeStatus('made_up_status'),null);
    assert.equal(canTransitionShipment('DELIVERED','IN_TRANSIT'),false);
    assert.equal(canTransitionShipment('DELIVERED','RETURNING'),true);
    assert.equal(canTransitionShipment('IN_TRANSIT','OUT_FOR_DELIVERY'),true);
    assert.equal(webhookEventKey({OrderCode:'ABC',Type:'switch_status',Time:'2026-10-12T10:00:00Z'}),'ABC:switch_status:2026-10-12T10:00:00.000Z');
    assert.equal(webhookEventKey({OrderCode:'ABC',Type:'switch_status',Time:'bad'}),null);
});

test('GHN create adapter sends credentials in headers and requires a provider order code',async()=>{
    let observed;
    const config={baseUrl:ENDPOINTS.staging,token:'local-test-token',shopId:'123'};
    const response=await createOrder({client_order_code:'GL1'},config,async(url,options)=>{observed={url,options};return {ok:true,json:async()=>({code:200,data:{order_code:'GHN1',total_fee:12000}})}});
    assert.equal(observed.url,`${ENDPOINTS.staging}/v2/shipping-order/create`);
    assert.equal(observed.options.headers.Token,'local-test-token');
    assert.equal(JSON.parse(observed.options.body).client_order_code,'GL1');
    assert.equal(response.orderCode,'GHN1');
    await assert.rejects(()=>createOrder({}, {}, async()=>{throw new Error('should not be called')}),/credentials are not configured/);
    await assert.rejects(()=>createOrder({},config,async()=>({ok:true,json:async()=>({code:400})})),/could not create/);
});

test('GHN order payload preserves legacy addresses and supports the new ward/province scheme',()=>{
    const order={order_code:'GL-ADDRESS-1',recipient_name:'Giftly Receiver',phone:'0900000000',payment_method:'COD',total_amount:150000};
    const items=[{name:'Gift Box',quantity:1,price:150000}];
    const packageInfo={weight:500,length:20,width:15,height:10};
    const oldConfig={fromName:'Giftly',fromPhone:'0900000001',fromAddress:'1 Old Street',fromWard:'Ward 1',fromDistrict:'District 1',fromProvince:'Old City',fromIsNewAddress:false};
    const oldPayload=buildGhnPayload({order,address:{addressLine:'2 Old Street',ward:'Ward 2',district:'District 2',city:'Old City',isNewAdministrativeAddress:false},items,packageInfo,config:oldConfig});
    assert.equal(oldPayload.is_new_to_address,false);
    assert.equal(oldPayload.to_district_name,'District 2');
    assert.equal(oldPayload.to_address,'2 Old Street, Ward 2, District 2, Old City');
    assert.equal(oldPayload.is_new_from_address,false);

    const newConfig={...oldConfig,fromWard:'Ward Central',fromDistrict:'',fromProvince:'New City',fromIsNewAddress:true};
    const newPayload=buildGhnPayload({order,address:{addressLine:'3 New Street',ward:'Ward Central',district:null,city:'New City',isNewAdministrativeAddress:true},items,packageInfo,config:newConfig});
    assert.equal(newPayload.is_new_to_address,true);
    assert.equal(newPayload.to_district_name,'');
    assert.equal(newPayload.to_address,'3 New Street, Ward Central, New City');
    assert.equal(newPayload.is_new_from_address,true);
    assert.equal(newPayload.from_district_name,'');
    assert.equal(newPayload.cod_amount,150000);
    assert.equal(buildGhnPayload({order,address:{addressLine:'2 Old Street',ward:'Ward 2',district:null,city:'Old City'},items,packageInfo,config:oldConfig}),null);
});

test('GHN sender configuration requires a district only for the legacy address scheme',()=>{
    const config={token:'test-token',shopId:'123',fromName:'Giftly',fromPhone:'0900000001',fromAddress:'1 Test Street',fromWard:'Ward Central',fromProvince:'Test City',fromDistrict:'',fromIsNewAddress:false,webhookSecret:'test-secret'};
    assert.equal(isShipmentConfigReady(config),false);
    assert.equal(isShipmentConfigReady({...config,fromDistrict:'District 1'}),true);
    assert.equal(isShipmentConfigReady({...config,fromIsNewAddress:true}),true);
});

test('GHN cancelOrder sends order_codes, headers and handles responses', async () => {
    let observed;
    const config = { baseUrl: ENDPOINTS.staging, token: 'local-test-token', shopId: '123' };
    const success = await cancelOrder({ orderCodes: ['GHN-TEST-1'] }, config, async (url, options) => {
        observed = { url, options };
        return { ok: true, json: async () => ({ code: 200, message: 'Success' }) };
    });
    assert.equal(observed.url, `${ENDPOINTS.staging}/v2/switch-status/cancel`);
    assert.equal(observed.options.method, 'POST');
    assert.equal(observed.options.headers.Token, 'local-test-token');
    assert.equal(observed.options.headers.ShopId, '123');
    assert.deepEqual(JSON.parse(observed.options.body), { order_codes: ['GHN-TEST-1'] });
    assert.equal(success, true);
    await assert.rejects(() => cancelOrder({}, {}, async () => {}), /credentials are not configured/);
});
