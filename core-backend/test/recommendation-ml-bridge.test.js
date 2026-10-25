const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {askMlService,askMlGiftFinder}=require('../services/recommendationService');

test('Node recommendation uses valid Python ranking and falls back on service errors',async(t)=>{
    let status=200;
    const server=http.createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{const input=JSON.parse(body);res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(status===200?{items:[{id:input.products[1].id,reasons:['test reason']},{id:input.products[0].id,reasons:[]}]}:{error:'offline'}))})});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    const previousUrl=process.env.ML_SERVICE_URL;const previousTimeout=process.env.ML_SERVICE_TIMEOUT_MS;
    t.after(()=>{if(previousUrl===undefined)delete process.env.ML_SERVICE_URL;else process.env.ML_SERVICE_URL=previousUrl;if(previousTimeout===undefined)delete process.env.ML_SERVICE_TIMEOUT_MS;else process.env.ML_SERVICE_TIMEOUT_MS=previousTimeout});
    process.env.ML_SERVICE_URL=`http://127.0.0.1:${server.address().port}`;
    const profile={categories:new Map(),occasions:new Map(),recipients:new Map(),interests:new Map(),styles:new Map(),giftTypes:new Map()};
    const ranked=[{product:{id:'1',status:'ACTIVE',stock:2,price:20}},{product:{id:'2',status:'ACTIVE',stock:1,price:30}}];
    let result=await askMlService(ranked,profile,2);
    assert.deepEqual(result.map(item=>item.product.id),['2','1']);
    status=503;
    result=await askMlService(ranked,profile,2);
    assert.equal(result,null);
});

test('Gift Finder forwards context to Python and keeps its candidate set bounded',async(t)=>{
    let observed;
    let status=200;
    const server=http.createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{observed={path:req.url,input:JSON.parse(body)};res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(status===200?{items:[{id:'2',reasons:['Python match']},{id:'1',reasons:['Python match']}]}:{error:'offline'}))})});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    const previousUrl=process.env.ML_SERVICE_URL;
    t.after(()=>{if(previousUrl===undefined)delete process.env.ML_SERVICE_URL;else process.env.ML_SERVICE_URL=previousUrl});
    process.env.ML_SERVICE_URL=`http://127.0.0.1:${server.address().port}`;
    const products=[
        {id:1,name:'Gift one',description:'First',status:'ACTIVE',stock:2,price:100000,occasion_tags:['birthday'],recipient_tags:[],interest_tags:[],is_featured:false},
        {id:2,name:'Gift two',description:'Second',status:'ACTIVE',stock:1,price:90000,occasion_tags:[],recipient_tags:['friend'],interest_tags:['coffee'],is_featured:false}
    ];
    const result=await askMlGiftFinder(products,{occasion:'birthday',recipient:'friend',interests:['coffee'],budget:120000,query:'Gift'});
    assert.equal(observed.path,'/gift-finder');
    assert.equal(observed.input.context.budget,120000);
    assert.equal(observed.input.preferences.interests.coffee,1);
    assert.deepEqual(result.map(item=>item.product.id),[2,1]);
    assert.deepEqual(result[0].reasons,['Python match']);
    status=503;
    assert.equal(await askMlGiftFinder(products,{query:'Gift'}),null,'Gift Finder can use its Node fallback when Python is offline');
});
