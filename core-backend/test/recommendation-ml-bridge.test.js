const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {askMlService,askMlGiftFinder,askMlRanker,resolveRecommendationSource}=require('../services/recommendationService');

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

const sampleRanked = [
    { product: { id: 1, name: 'Sản phẩm 1', price: 100000 } },
    { product: { id: 2, name: 'Sản phẩm 2', price: 200000 } }
];

test('Branch 1: askMlRanker forwards source=ranker_lc1 correctly when model executes', async (t) => {
    let observed = null;
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            observed = { path: req.url, method: req.method, input: JSON.parse(body) };
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                user_id: observed.input.user_id,
                source: 'ranker_lc1',
                items: [
                    { id: 2, score: 0.95, reasons: ['Gợi ý từ ItemKNN #1'] },
                    { id: 1, score: 0.72, reasons: ['Phù hợp sở thích'] }
                ]
            }));
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));

    const prevUrl = process.env.ML_SERVICE_URL;
    t.after(() => {
        if (prevUrl === undefined) delete process.env.ML_SERVICE_URL;
        else process.env.ML_SERVICE_URL = prevUrl;
    });
    process.env.ML_SERVICE_URL = `http://127.0.0.1:${server.address().port}`;

    const res = await askMlRanker(12345, sampleRanked, 2);
    assert.equal(observed.path, '/recommend/rank');
    assert.equal(observed.method, 'POST');
    assert.equal(observed.input.user_id, 12345);
    assert.deepEqual(observed.input.candidate_ids, [1, 2]);
    assert.notEqual(res, null);
    assert.equal(res.source, 'ranker_lc1');
    assert.deepEqual(res.items.map(item => item.product.id), [2, 1]);
    assert.deepEqual(res.items[0].reasons, ['Gợi ý từ ItemKNN #1']);

    const resolved = resolveRecommendationSource(res, null);
    assert.equal(resolved, 'ranker_lc1', 'Nhánh mô hình thật phải chuyển tiếp đúng ranker_lc1');
});

test('Branch 2: askMlRanker forwards source=popularity_fallback for cold user with known candidates', async (t) => {
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const input = JSON.parse(body);
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                user_id: input.user_id,
                source: 'popularity_fallback',
                items: [
                    { id: 1, score: 250.0, reasons: ['Sản phẩm thịnh hành có lượt tương tác cao'] },
                    { id: 2, score: 100.0, reasons: ['Sản phẩm thịnh hành có lượt tương tác cao'] }
                ]
            }));
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));

    const prevUrl = process.env.ML_SERVICE_URL;
    t.after(() => {
        if (prevUrl === undefined) delete process.env.ML_SERVICE_URL;
        else process.env.ML_SERVICE_URL = prevUrl;
    });
    process.env.ML_SERVICE_URL = `http://127.0.0.1:${server.address().port}`;

    const res = await askMlRanker(999999, sampleRanked, 2);
    assert.notEqual(res, null);
    assert.equal(res.source, 'popularity_fallback');
    assert.deepEqual(res.items.map(item => item.product.id), [1, 2]);

    const resolved = resolveRecommendationSource(res, null);
    assert.equal(resolved, 'popularity_fallback', 'Nhánh cold user phải trả đúng popularity_fallback, KHÔNG được gắn LC-1');
});

test('Branch 3: askMlRanker handles source=unknown_candidates and falls back without LC-1 label', async (t) => {
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                user_id: null,
                source: 'unknown_candidates',
                total_candidates: 0,
                items: []
            }));
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));

    const prevUrl = process.env.ML_SERVICE_URL;
    t.after(() => {
        if (prevUrl === undefined) delete process.env.ML_SERVICE_URL;
        else process.env.ML_SERVICE_URL = prevUrl;
    });
    process.env.ML_SERVICE_URL = `http://127.0.0.1:${server.address().port}`;

    const res = await askMlRanker(null, sampleRanked, 2);
    assert.notEqual(res, null);
    assert.equal(res.source, 'unknown_candidates');
    assert.equal(res.items.length, 0);

    const resolved = resolveRecommendationSource(res, null);
    assert.equal(resolved, 'node_fallback', 'Khi ứng viên không thuộc pool, backend rơi về node_fallback');
    assert.notEqual(resolved, 'ranker_lc1', 'Tuyệt đối không được gắn nhãn LC-1 khi ứng viên không thuộc pool');
});

test('Branch 4: HTTP 5xx service failure falls back gracefully to node_fallback', async (t) => {
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            res.writeHead(503, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'Service Unavailable' }));
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));

    const prevUrl = process.env.ML_SERVICE_URL;
    t.after(() => {
        if (prevUrl === undefined) delete process.env.ML_SERVICE_URL;
        else process.env.ML_SERVICE_URL = prevUrl;
    });
    process.env.ML_SERVICE_URL = `http://127.0.0.1:${server.address().port}`;

    const res = await askMlRanker(12345, sampleRanked, 2);
    assert.equal(res, null, 'Khi HTTP lỗi 503, askMlRanker trả về null');

    const resolved = resolveRecommendationSource(res, null);
    assert.equal(resolved, 'node_fallback', 'Khi ML service lỗi 503, backend rơi về node_fallback');
    assert.notEqual(resolved, 'ranker_lc1', 'Không được gắn nhãn LC-1 khi có lỗi 5xx');
});

test('Branch 5: network timeout falls back gracefully to node_fallback', async (t) => {
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            setTimeout(() => {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ success: true, source: 'ranker_lc1', items: [] }));
            }, 350);
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));

    const prevUrl = process.env.ML_SERVICE_URL;
    const prevTimeout = process.env.ML_SERVICE_TIMEOUT_MS;
    t.after(() => {
        if (prevUrl === undefined) delete process.env.ML_SERVICE_URL;
        else process.env.ML_SERVICE_URL = prevUrl;
        if (prevTimeout === undefined) delete process.env.ML_SERVICE_TIMEOUT_MS;
        else process.env.ML_SERVICE_TIMEOUT_MS = prevTimeout;
    });
    process.env.ML_SERVICE_URL = `http://127.0.0.1:${server.address().port}`;
    process.env.ML_SERVICE_TIMEOUT_MS = '100';

    const res = await askMlRanker(12345, sampleRanked, 2);
    assert.equal(res, null, 'Khi timeout, askMlRanker trả về null');

    const resolved = resolveRecommendationSource(res, null);
    assert.equal(resolved, 'node_fallback', 'Khi ML timeout, backend rơi về node_fallback');
    assert.notEqual(resolved, 'ranker_lc1', 'Không được gắn nhãn LC-1 khi timeout');
});
