const test = require('node:test');
const assert = require('node:assert/strict');
const { mlPayload,applyMlRanking } = require('../services/recommendationService');

test('ML bridge sends only current available product metadata and normalized preferences',()=>{
    const product={id:7,status:'ACTIVE',stock:2,price:125000,category_id:3,occasion_tags:'["birthday"]',recipient_tags:null,interest_tags:'["coffee"]',style:'minimal',gift_type:'food',is_featured:1,event_count:4,average_rating:4};
    const profile={categories:new Map([['3',{weight:4,label:'3'}]]),occasions:new Map([['birthday',{weight:2,label:'birthday'}]])};
    const payload=mlPayload([{product}],profile,5);
    assert.equal(payload.products[0].id,'7');
    assert.deepEqual(payload.products[0].occasionTags,['birthday']);
    assert.equal(payload.preferences.categories['3'],1);
    assert.equal(payload.limit,5);
});

test('ML results can reorder only known candidates and reject malformed/unknown IDs',()=>{
    const ranked=[{product:{id:1}},{product:{id:2}}];
    assert.deepEqual(applyMlRanking(ranked,{items:[{id:'2',reasons:['shared interest']},{id:'1',reasons:[]}]}).map(x=>x.product.id),[2,1]);
    assert.equal(applyMlRanking(ranked,{items:[{id:'999',reasons:[]}]}),null);
    assert.equal(applyMlRanking(ranked,{items:[{id:'1',reasons:[3]}]}),null);
});
