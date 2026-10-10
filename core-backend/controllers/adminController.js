const pool=require('../config/db');
const {orderView,getOrderData,restoreStock,releaseCoupon}=require('./orderController');

const productColumns=`SELECT p.*,c.name category_name,0 average_rating,0 review_count FROM products p LEFT JOIN categories c ON c.id=p.category_id`;
const allowedStatuses=['PENDING','CONFIRMED','PROCESSING','SHIPPED','DELIVERED','CANCELLED'];
const transitions={PENDING:['CONFIRMED','CANCELLED'],CONFIRMED:['PROCESSING','CANCELLED'],PROCESSING:['SHIPPED','CANCELLED'],SHIPPED:['DELIVERED'],DELIVERED:[],CANCELLED:[]};
const validId=(value)=>/^\d+$/.test(String(value||''));

async function productGallery(connection,productIds){
    if(!productIds.length)return new Map();
    const placeholders=productIds.map(()=>'?').join(',');
    const [rows]=await connection.execute(`SELECT product_id,image_url FROM product_images WHERE product_id IN (${placeholders}) ORDER BY product_id,sort_order,id`,productIds);
    const gallery=new Map();
    for(const row of rows){const id=String(row.product_id);if(!gallery.has(id))gallery.set(id,[]);gallery.get(id).push(row.image_url)}
    return gallery;
}

async function saveProductGallery(connection,productId,images,altText){
    if(images===null)return;
    await connection.execute('DELETE FROM product_images WHERE product_id=?',[productId]);
    for(let index=0;index<images.length;index++){
        await connection.execute('INSERT INTO product_images (product_id,image_url,alt_text,sort_order) VALUES (?,?,?,?)',[productId,images[index],altText,index]);
    }
}

async function productAdminView(connection,productId){
    const [[row]]=await connection.execute(`${productColumns} WHERE p.id=?`,[productId]);
    if(!row)return null;
    const gallery=await productGallery(connection,[productId]);
    return {...require('./catalogController').present(row),galleryImages:gallery.get(String(productId))||[]};
}

function bannerInput(body){
    const {title,subtitle,imageUrl,targetUrl,buttonText,isActive=true,sortOrder=0,startsAt,endsAt}=body||{};
    const optionalText=(value,max)=>value==null||value===''||(typeof value==='string'&&value.trim().length<=max);
    const secureUrl=(value)=>{try{const parsed=new URL(value.trim());return parsed.protocol==='https:'&&!parsed.username&&!parsed.password}catch{return false}};
    const imageIsValid=typeof imageUrl==='string'&&imageUrl.length<=2048&&secureUrl(imageUrl);
    let targetIsValid=targetUrl==null||targetUrl===''||(typeof targetUrl==='string'&&targetUrl.length<=2048&&targetUrl.trim().length>0);
    if(targetIsValid&&targetUrl){
        const target=targetUrl.trim();
        if(target.startsWith('/')) targetIsValid=!target.startsWith('//')&&!target.includes('\\')&&!/[\u0000-\u001f]/.test(target);
        else targetIsValid=secureUrl(target);
    }
    const dateValue=(value)=>{
        if(value==null||value==='')return null;
        if(typeof value!=='string'||value.length>40||!Number.isFinite(Date.parse(value)))return undefined;
        return new Date(value).toISOString().slice(0,19).replace('T',' ');
    };
    const start=dateValue(startsAt),end=dateValue(endsAt);
    if(typeof title!=='string'||!title.trim()||title.trim().length>120||!optionalText(subtitle,300)||!imageIsValid||!targetIsValid||
        !optionalText(buttonText,40)||typeof isActive!=='boolean'||!Number.isInteger(Number(sortOrder))||Number(sortOrder)<-10000||Number(sortOrder)>100000||
        start===undefined||end===undefined||(start&&end&&new Date(`${start.replace(' ','T')}Z`)>=new Date(`${end.replace(' ','T')}Z`)))return null;
    return {title:title.trim(),subtitle:subtitle?.trim()||null,imageUrl:imageUrl.trim(),targetUrl:targetUrl?.trim()||null,
        buttonText:buttonText?.trim()||null,isActive,sortOrder:Number(sortOrder),startsAt:start,endsAt:end};
}

function bannerView(row){
    const date=(value)=>value?new Date(value).toISOString():null;
    return {id:String(row.id),title:row.title,subtitle:row.subtitle,imageUrl:row.image_url,targetUrl:row.target_url,
        buttonText:row.button_text,isActive:Boolean(row.is_active),sortOrder:Number(row.sort_order),startsAt:date(row.starts_at),endsAt:date(row.ends_at),
        createdAt:row.created_at,updatedAt:row.updated_at};
}

async function listBanners(req,res,next){
    try{
        const [rows]=await pool.query(`SELECT id,title,subtitle,image_url,target_url,button_text,is_active,sort_order,
            DATE_FORMAT(starts_at,'%Y-%m-%dT%H:%i:%sZ') starts_at,DATE_FORMAT(ends_at,'%Y-%m-%dT%H:%i:%sZ') ends_at,created_at,updated_at
            FROM homepage_banners ORDER BY sort_order,id DESC LIMIT 100`);
        return res.json({success:true,data:rows.map(bannerView)});
    }catch(error){return next(error)}
}

async function createBanner(req,res,next){
    const value=bannerInput(req.body);if(!value)return res.status(400).json({success:false,message:'Invalid banner fields.'});
    try{
        const [result]=await pool.execute(`INSERT INTO homepage_banners
            (title,subtitle,image_url,target_url,button_text,is_active,sort_order,starts_at,ends_at,created_by)
            VALUES (?,?,?,?,?,?,?,?,?,?)`,[value.title,value.subtitle,value.imageUrl,value.targetUrl,value.buttonText,value.isActive?1:0,value.sortOrder,value.startsAt,value.endsAt,req.user.id]);
        await audit(req.user.id,'BANNER_CREATE','banner',result.insertId,{title:value.title,isActive:value.isActive});
        const [[row]]=await pool.execute(`SELECT id,title,subtitle,image_url,target_url,button_text,is_active,sort_order,
            DATE_FORMAT(starts_at,'%Y-%m-%dT%H:%i:%sZ') starts_at,DATE_FORMAT(ends_at,'%Y-%m-%dT%H:%i:%sZ') ends_at,created_at,updated_at
            FROM homepage_banners WHERE id=?`,[result.insertId]);
        return res.status(201).json({success:true,data:bannerView(row)});
    }catch(error){return next(error)}
}

async function updateBanner(req,res,next){
    if(!validId(req.params.id))return res.status(400).json({success:false,message:'Invalid banner id.'});
    const value=bannerInput(req.body);if(!value)return res.status(400).json({success:false,message:'Invalid banner fields.'});
    try{
        const [result]=await pool.execute(`UPDATE homepage_banners SET title=?,subtitle=?,image_url=?,target_url=?,button_text=?,is_active=?,sort_order=?,starts_at=?,ends_at=? WHERE id=?`,
            [value.title,value.subtitle,value.imageUrl,value.targetUrl,value.buttonText,value.isActive?1:0,value.sortOrder,value.startsAt,value.endsAt,req.params.id]);
        if(!result.affectedRows){const [[row]]=await pool.execute('SELECT id FROM homepage_banners WHERE id=?',[req.params.id]);if(!row)return res.status(404).json({success:false,message:'Banner not found.'})}
        await audit(req.user.id,'BANNER_UPDATE','banner',req.params.id,{title:value.title,isActive:value.isActive});
        const [[row]]=await pool.execute(`SELECT id,title,subtitle,image_url,target_url,button_text,is_active,sort_order,
            DATE_FORMAT(starts_at,'%Y-%m-%dT%H:%i:%sZ') starts_at,DATE_FORMAT(ends_at,'%Y-%m-%dT%H:%i:%sZ') ends_at,created_at,updated_at
            FROM homepage_banners WHERE id=?`,[req.params.id]);
        return res.json({success:true,data:bannerView(row)});
    }catch(error){return next(error)}
}

async function archiveBanner(req,res,next){
    if(!validId(req.params.id))return res.status(400).json({success:false,message:'Invalid banner id.'});
    try{
        const [result]=await pool.execute('UPDATE homepage_banners SET is_active=0 WHERE id=?',[req.params.id]);
        if(result.affectedRows)await audit(req.user.id,'BANNER_ARCHIVE','banner',req.params.id,null);
        else {const [[row]]=await pool.execute('SELECT id FROM homepage_banners WHERE id=?',[req.params.id]);if(!row)return res.status(404).json({success:false,message:'Banner not found.'})}
        return res.json({success:true});
    }catch(error){return next(error)}
}

function productInput(body){
    const {name,description,price,stock,categoryId,imageUrl,occasionTags=[],recipientTags=[],interestTags=[],style,giftType,status='ACTIVE',isFeatured=false}=body||{};
    const galleryImages=body?.galleryImages===undefined?null:body.galleryImages;
    const validGalleryImage=(value)=>{
        if(typeof value!=='string'||value.length>500)return false;
        try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&Boolean(url.hostname)}catch{return false}
    };
    if(typeof name!=='string'||!name.trim()||name.trim().length>200||
        (description!=null&&(typeof description!=='string'||description.length>10000))||
        !Number.isFinite(Number(price))||Number(price)<0||Number(price)>9999999999||
        !Number.isInteger(Number(stock))||Number(stock)<0||Number(stock)>4294967295||
        (categoryId!=null&&categoryId!==''&&!validId(categoryId))||
        (imageUrl!=null&&imageUrl!==''&&!/^https?:\/\//i.test(imageUrl))||
        !['ACTIVE','INACTIVE'].includes(status)||
        !Array.isArray(occasionTags)||!Array.isArray(recipientTags)||!Array.isArray(interestTags)||
        [...occasionTags,...recipientTags,...interestTags].some((v)=>typeof v!=='string'||v.length>80)||
        (galleryImages!==null&&(!Array.isArray(galleryImages)||galleryImages.length>8||galleryImages.some((url)=>!validGalleryImage(url))||new Set(galleryImages).size!==galleryImages.length||galleryImages.includes(imageUrl)))||
        (style!=null&&(typeof style!=='string'||style.length>80))||(giftType!=null&&(typeof giftType!=='string'||giftType.length>80)))return null;
    return {name:name.trim(),description:description?.trim()||null,price:Number(price),stock:Number(stock),categoryId:categoryId||null,
        imageUrl:imageUrl||null,occasionTags,recipientTags,interestTags,style:style||null,giftType:giftType||null,status,isFeatured:Boolean(isFeatured),galleryImages};
}

async function dashboard(req,res,next){
    try{
        const from=typeof req.query.from==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(req.query.from)?req.query.from:null;
        const to=typeof req.query.to==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(req.query.to)?req.query.to:null;
        const [[summary]]=await pool.execute(`SELECT COUNT(*) order_count,
            SUM(status='PENDING') pending_orders,SUM(status='SHIPPED') shipping_orders,SUM(status='DELIVERED') completed_orders,SUM(status='CANCELLED') cancelled_orders,
            COALESCE(SUM(CASE WHEN payment_status='PAID' THEN total_amount ELSE 0 END),0) revenue,
            COALESCE(AVG(CASE WHEN payment_status='PAID' THEN total_amount END),0) average_order_value
            FROM orders WHERE (? IS NULL OR DATE(created_at)>=?) AND (? IS NULL OR DATE(created_at)<=?)`,[from,from,to,to]);
        const [[totals]]=await pool.query(`SELECT (SELECT COUNT(*) FROM users WHERE role='USER') customer_count,
            (SELECT COUNT(*) FROM products WHERE status='ACTIVE') product_count,
            (SELECT COUNT(*) FROM products WHERE status='ACTIVE' AND stock<=5) low_stock_count,
            (SELECT COUNT(*) FROM orders WHERE status='PENDING') queue_count`);
        const [[newCustomerCount]]=await pool.execute('SELECT COUNT(*) total FROM users WHERE (? IS NULL OR DATE(created_at)>=?) AND (? IS NULL OR DATE(created_at)<=?)',[from,from,to,to]);
        const [daily]=await pool.execute(`SELECT DATE(created_at) day,COUNT(*) orders_count,COALESCE(SUM(CASE WHEN payment_status='PAID' THEN total_amount ELSE 0 END),0) revenue
            FROM orders WHERE created_at>=DATE_SUB(CURDATE(),INTERVAL 13 DAY) GROUP BY DATE(created_at) ORDER BY day`);
        const [bestSellers]=await pool.execute(`SELECT oi.product_id,oi.product_name,SUM(oi.quantity) units,SUM(oi.line_total) gross
            FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status<>'CANCELLED' GROUP BY oi.product_id,oi.product_name ORDER BY units DESC LIMIT 5`);
        const [categoryPerformance]=await pool.query(`SELECT c.id,c.name,SUM(oi.quantity) units,SUM(oi.line_total) gross FROM order_items oi
            JOIN orders o ON o.id=oi.order_id JOIN products p ON p.id=oi.product_id LEFT JOIN categories c ON c.id=p.category_id
            WHERE o.status<>'CANCELLED' GROUP BY c.id,c.name ORDER BY gross DESC LIMIT 5`);
        return res.json({success:true,data:{summary:{orders:Number(summary.order_count||0),pending:Number(summary.pending_orders||0),shipping:Number(summary.shipping_orders||0),completed:Number(summary.completed_orders||0),cancelled:Number(summary.cancelled_orders||0),revenue:Number(summary.revenue),averageOrderValue:Number(summary.average_order_value),customers:Number(totals.customer_count),newCustomers:Number(newCustomerCount.total),products:Number(totals.product_count),lowStock:Number(totals.low_stock_count),queue:Number(totals.queue_count)},daily:daily.map((r)=>({date:r.day,orders:Number(r.orders_count),revenue:Number(r.revenue)})),bestSellers:bestSellers.map((r)=>({productId:r.product_id==null?null:String(r.product_id),name:r.product_name,units:Number(r.units),gross:Number(r.gross)})),categoryPerformance:categoryPerformance.map(r=>({categoryId:r.id==null?null:String(r.id),name:r.name||'Chưa phân loại',units:Number(r.units),gross:Number(r.gross)}))}});
    }catch(error){return next(error)}
}

async function listProducts(req,res,next){
    try{
        const page=Math.max(1,Number.parseInt(req.query.page,10)||1),limit=Math.min(100,Math.max(1,Number.parseInt(req.query.limit,10)||20));
        const params=[],where=[];
        if(req.query.q){where.push('(p.name LIKE ? OR p.description LIKE ?)');params.push(`%${String(req.query.q).slice(0,100)}%`,`%${String(req.query.q).slice(0,100)}%`)}
        if(req.query.status&&['ACTIVE','INACTIVE'].includes(req.query.status)){where.push('p.status=?');params.push(req.query.status)}
        if(req.query.categoryId&&validId(req.query.categoryId)){where.push('p.category_id=?');params.push(req.query.categoryId)}
        const sqlWhere=where.length?` WHERE ${where.join(' AND ')}`:'';
        const [items]=await pool.execute(`${productColumns}${sqlWhere} ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`,[...params,limit,(page-1)*limit]);
        const [[count]]=await pool.execute(`SELECT COUNT(*) total FROM products p${sqlWhere}`,params);
        const gallery=await productGallery(pool,items.map((item)=>item.id));
        return res.json({success:true,data:{items:items.map((item)=>({...require('./catalogController').present(item),galleryImages:gallery.get(String(item.id))||[]})),pagination:{page,limit,total:Number(count.total),pages:Math.ceil(Number(count.total)/limit)}}});
    }catch(error){return next(error)}
}

async function createProduct(req,res,next){
    const value=productInput(req.body);if(!value)return res.status(400).json({success:false,message:'Invalid product fields.'});
    const connection=await pool.getConnection();
    try{
        await connection.beginTransaction();
        if(value.categoryId){const [[category]]=await connection.execute('SELECT id FROM categories WHERE id=? AND is_active=1',[value.categoryId]);if(!category){await connection.rollback();return res.status(400).json({success:false,message:'Choose an active category.'})}}
        const [result]=await connection.execute(`INSERT INTO products (category_id,name,description,price,stock,image_url,status,occasion_tags,recipient_tags,interest_tags,style,gift_type,is_featured)
            VALUES (?,?,?,?,?,?,?,CAST(? AS JSON),CAST(? AS JSON),CAST(? AS JSON),?,?,?)`,[value.categoryId,value.name,value.description,value.price,value.stock,value.imageUrl,value.status,JSON.stringify(value.occasionTags),JSON.stringify(value.recipientTags),JSON.stringify(value.interestTags),value.style,value.giftType,value.isFeatured]);
        if(value.stock)await connection.execute("INSERT INTO inventory_movements (product_id,changed_by,quantity_delta,reason) VALUES (?,?,?,'Initial product stock')",[result.insertId,req.user.id,value.stock]);
        await saveProductGallery(connection,result.insertId,value.galleryImages||[],value.name);
        await connection.execute('INSERT INTO admin_audit_logs (admin_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,CAST(? AS JSON))',[req.user.id,'PRODUCT_CREATE','product',result.insertId,JSON.stringify({name:value.name,galleryImageCount:value.galleryImages?.length||0})]);
        const product=await productAdminView(connection,result.insertId);
        await connection.commit();
        return res.status(201).json({success:true,data:product});
    }catch(error){await connection.rollback();return next(error)}finally{connection.release()}
}

async function updateProduct(req,res,next){
    if(!validId(req.params.id))return res.status(400).json({success:false,message:'Invalid product id.'});
    const value=productInput(req.body);if(!value)return res.status(400).json({success:false,message:'Invalid product fields.'});
    const connection=await pool.getConnection();
    try{
        await connection.beginTransaction();
        const [current]=await connection.execute('SELECT stock FROM products WHERE id=? FOR UPDATE',[req.params.id]);
        if(!current[0]){await connection.rollback();return res.status(404).json({success:false,message:'Product not found.'})}
        if(value.categoryId){const [[category]]=await connection.execute('SELECT id FROM categories WHERE id=? AND is_active=1',[value.categoryId]);if(!category){await connection.rollback();return res.status(400).json({success:false,message:'Choose an active category.'})}}
        await connection.execute(`UPDATE products SET category_id=?,name=?,description=?,price=?,stock=?,image_url=?,status=?,occasion_tags=CAST(? AS JSON),recipient_tags=CAST(? AS JSON),interest_tags=CAST(? AS JSON),style=?,gift_type=?,is_featured=? WHERE id=?`,
            [value.categoryId,value.name,value.description,value.price,value.stock,value.imageUrl,value.status,JSON.stringify(value.occasionTags),JSON.stringify(value.recipientTags),JSON.stringify(value.interestTags),value.style,value.giftType,value.isFeatured,req.params.id]);
        await saveProductGallery(connection,req.params.id,value.galleryImages,value.name);
        const delta=value.stock-Number(current[0].stock);
        if(delta)await connection.execute('INSERT INTO inventory_movements (product_id,changed_by,quantity_delta,reason) VALUES (?,?,?,?)',[req.params.id,req.user.id,delta,String(req.body.stockReason||'Admin stock adjustment').slice(0,300)]);
        await connection.execute('INSERT INTO admin_audit_logs (admin_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,CAST(? AS JSON))',[req.user.id,'PRODUCT_UPDATE','product',req.params.id,JSON.stringify({name:value.name,stockDelta:delta,galleryImageCount:value.galleryImages?.length})]);
        const product=await productAdminView(connection,req.params.id);
        await connection.commit();
        return res.json({success:true,data:product});
    }catch(error){await connection.rollback();return next(error)}finally{connection.release()}
}

async function archiveProduct(req,res,next){
    try{const [result]=await pool.execute("UPDATE products SET status='INACTIVE' WHERE id=? AND status='ACTIVE'",[req.params.id]);if(!result.affectedRows)return res.status(404).json({success:false,message:'Active product not found.'});await audit(req.user.id,'PRODUCT_ARCHIVE','product',req.params.id,null);return res.json({success:true})}catch(error){return next(error)}
}

async function listCategories(req,res,next){
    try{const [rows]=await pool.query(`SELECT c.id,c.name,c.description,c.sort_order,c.is_active,COUNT(p.id) product_count FROM categories c LEFT JOIN products p ON p.category_id=c.id GROUP BY c.id ORDER BY c.sort_order,c.name`);return res.json({success:true,data:rows.map((r)=>({id:String(r.id),name:r.name,description:r.description,sortOrder:r.sort_order,isActive:Boolean(r.is_active),productCount:Number(r.product_count)}))})}catch(error){return next(error)}
}

async function saveCategory(req,res,next){
    const {name,description,sortOrder=0,isActive=true}=req.body||{};
    if(typeof name!=='string'||!name.trim()||name.length>100||(description!=null&&(typeof description!=='string'||description.length>2000))||!Number.isInteger(Number(sortOrder))||typeof isActive!=='boolean')return res.status(400).json({success:false,message:'Invalid category.'});
    try{
        if(req.params.id){const [result]=await pool.execute('UPDATE categories SET name=?,description=?,sort_order=?,is_active=? WHERE id=?',[name.trim(),description?.trim()||null,Number(sortOrder),isActive?1:0,req.params.id]);if(!result.affectedRows)return res.status(404).json({success:false,message:'Category not found.'});await audit(req.user.id,'CATEGORY_UPDATE','category',req.params.id,{name:name.trim(),isActive});return res.json({success:true})}
        const [result]=await pool.execute('INSERT INTO categories (name,description,sort_order) VALUES (?,?,?)',[name.trim(),description?.trim()||null,Number(sortOrder)]);await audit(req.user.id,'CATEGORY_CREATE','category',result.insertId,{name:name.trim()});return res.status(201).json({success:true,data:{id:String(result.insertId),name:name.trim()}})
    }catch(error){return next(error)}
}

async function archiveCategory(req,res,next){
    try{const [result]=await pool.execute('UPDATE categories SET is_active=0 WHERE id=?',[req.params.id]);if(!result.affectedRows)return res.status(404).json({success:false,message:'Category not found.'});await audit(req.user.id,'CATEGORY_ARCHIVE','category',req.params.id,null);return res.json({success:true})}catch(error){return next(error)}
}

async function listOrders(req,res,next){
    try{
        const page=Math.max(1,Number.parseInt(req.query.page,10)||1),limit=Math.min(100,Math.max(1,Number.parseInt(req.query.limit,10)||20));
        const where=[],params=[];
        const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
        if((req.query.from&&!validDate(req.query.from))||(req.query.to&&!validDate(req.query.to))||(req.query.from&&req.query.to&&req.query.from>req.query.to))return res.status(400).json({success:false,message:'Invalid order date range.'});
        if(req.query.paymentStatus&&!['UNPAID','PAID','REFUNDED'].includes(req.query.paymentStatus))return res.status(400).json({success:false,message:'Invalid payment status.'});
        if(req.query.status&&allowedStatuses.includes(req.query.status)){where.push('o.status=?');params.push(req.query.status)}
        if(req.query.paymentStatus){where.push('o.payment_status=?');params.push(req.query.paymentStatus)}
        if(req.query.q){const q=`%${String(req.query.q).slice(0,80)}%`;where.push('(o.order_code LIKE ? OR u.email LIKE ? OR o.recipient_name LIKE ?)');params.push(q,q,q)}
        if(req.query.from){where.push('o.created_at>=?');params.push(`${req.query.from} 00:00:00`)}
        if(req.query.to){where.push('o.created_at<=?');params.push(`${req.query.to} 23:59:59`)}
        const clause=where.length?`WHERE ${where.join(' AND ')}`:'';
        const [rows]=await pool.execute(`SELECT o.*,COUNT(oi.id) item_count,u.email customer_email FROM orders o JOIN users u ON u.id=o.user_id LEFT JOIN order_items oi ON oi.order_id=o.id ${clause} GROUP BY o.id ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,[...params,limit,(page-1)*limit]);
        const [[count]]=await pool.execute(`SELECT COUNT(*) total FROM orders o JOIN users u ON u.id=o.user_id ${clause}`,params);
        return res.json({success:true,data:{items:rows.map((r)=>({...orderView(r),customerEmail:r.customer_email})),pagination:{page,limit,total:Number(count.total),pages:Math.ceil(Number(count.total)/limit)}}});
    }catch(error){return next(error)}
}

async function adjustInventory(req,res,next){
    const quantityDelta=Number(req.body?.quantityDelta),reason=req.body?.reason;
    if(!validId(req.params.id)||!Number.isInteger(quantityDelta)||quantityDelta===0||Math.abs(quantityDelta)>1000000||
        typeof reason!=='string'||reason.trim().length<3||reason.trim().length>300){
        return res.status(400).json({success:false,message:'Provide a valid non-zero stock adjustment and a reason (3–300 characters).'});
    }
    const connection=await pool.getConnection();
    try{
        await connection.beginTransaction();
        const [rows]=await connection.execute('SELECT id,stock FROM products WHERE id=? FOR UPDATE',[req.params.id]);
        if(!rows[0]){await connection.rollback();return res.status(404).json({success:false,message:'Product not found.'})}
        const nextStock=Number(rows[0].stock)+quantityDelta;
        if(nextStock<0||nextStock>4294967295){await connection.rollback();return res.status(409).json({success:false,message:'Stock adjustment would exceed the allowed inventory range.'})}
        await connection.execute('UPDATE products SET stock=? WHERE id=?',[nextStock,req.params.id]);
        await connection.execute('INSERT INTO inventory_movements (product_id,changed_by,quantity_delta,reason) VALUES (?,?,?,?)',[req.params.id,req.user.id,quantityDelta,reason.trim()]);
        await connection.execute('INSERT INTO admin_audit_logs (admin_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,CAST(? AS JSON))',[req.user.id,'INVENTORY_ADJUST','product',req.params.id,JSON.stringify({quantityDelta,reason:reason.trim(),stock:nextStock})]);
        await connection.commit();
        return res.json({success:true,data:{productId:String(req.params.id),stock:nextStock,quantityDelta}});
    }catch(error){await connection.rollback();return next(error)}finally{connection.release()}
}

async function listInventory(req,res,next){
    try{
        const page=Math.max(1,Number.parseInt(req.query.page,10)||1),limit=Math.min(100,Math.max(1,Number.parseInt(req.query.limit,10)||50));
        const where=[],params=[];
        if(req.query.productId){if(!validId(req.query.productId))return res.status(400).json({success:false,message:'Invalid product id.'});where.push('m.product_id=?');params.push(req.query.productId)}
        if(req.query.q){const q=`%${String(req.query.q).slice(0,100)}%`;where.push('(p.name LIKE ? OR m.reason LIKE ?)');params.push(q,q)}
        const clause=where.length?`WHERE ${where.join(' AND ')}`:'';
        const [rows]=await pool.execute(`SELECT m.id,m.product_id,m.changed_by,m.quantity_delta,m.reason,m.order_id,m.created_at,p.name product_name,u.full_name changed_by_name,o.order_code
            FROM inventory_movements m LEFT JOIN products p ON p.id=m.product_id LEFT JOIN users u ON u.id=m.changed_by LEFT JOIN orders o ON o.id=m.order_id
            ${clause} ORDER BY m.created_at DESC,m.id DESC LIMIT ? OFFSET ?`,[...params,limit,(page-1)*limit]);
        const [[count]]=await pool.execute(`SELECT COUNT(*) total FROM inventory_movements m LEFT JOIN products p ON p.id=m.product_id ${clause}`,params);
        return res.json({success:true,data:{items:rows.map(r=>({id:String(r.id),productId:String(r.product_id),productName:r.product_name,changedBy:r.changed_by==null?null:String(r.changed_by),changedByName:r.changed_by_name,quantityDelta:Number(r.quantity_delta),reason:r.reason,orderId:r.order_id==null?null:String(r.order_id),orderCode:r.order_code,createdAt:r.created_at})),pagination:{page,limit,total:Number(count.total),pages:Math.ceil(Number(count.total)/limit)}}});
    }catch(error){return next(error)}
}

async function adminOrderDetail(req,res,next){
    try{const order=await getOrderData(pool,req.params.id,'o.id=?',[req.params.id]);if(!order)return res.status(404).json({success:false,message:'Order not found.'});return res.json({success:true,data:order})}catch(error){return next(error)}
}

async function updateOrderStatus(req,res,next){
    const {status,note}=req.body||{};
    if(!allowedStatuses.includes(status)||(note!=null&&(typeof note!=='string'||note.length>500)))return res.status(400).json({success:false,message:'Invalid order status update.'});
    const connection=await pool.getConnection();
    try{
        await connection.beginTransaction();
        const [rows]=await connection.execute('SELECT * FROM orders WHERE id=? FOR UPDATE',[req.params.id]);
        const order=rows[0];if(!order){await connection.rollback();return res.status(404).json({success:false,message:'Order not found.'})}
        if(!transitions[order.status].includes(status)){await connection.rollback();return res.status(409).json({success:false,message:`Order cannot move from ${order.status} to ${status}.`})}
        if(status==='CANCELLED'){await restoreStock(connection,order.id,req.user.id);await releaseCoupon(connection,order.id)}
        await connection.execute('UPDATE orders SET status=?,payment_status=IF(?=\'DELIVERED\' AND payment_method=\'COD\',\'PAID\',payment_status) WHERE id=?',[status,status,order.id]);
        await connection.execute('INSERT INTO order_status_history (order_id,changed_by,from_status,to_status,note) VALUES (?,?,?,?,?)',[order.id,req.user.id,order.status,status,note?.trim()||'Status updated by admin']);
        await connection.execute('INSERT INTO notifications (user_id,type,title,body,order_id) VALUES (? ,\'ORDER\',?,?,?)',[order.user_id,`Cập nhật đơn ${order.order_code}`,`Trạng thái đơn hàng: ${status}.`,order.id]);
        await connection.execute('INSERT INTO admin_audit_logs (admin_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,CAST(? AS JSON))',[req.user.id,'ORDER_STATUS','order',order.id,JSON.stringify({from:order.status,to:status,note:note||null})]);
        await connection.commit();return res.json({success:true,data:{orderCode:order.order_code,status,paymentStatus:status==='DELIVERED'&&order.payment_method==='COD'?'PAID':order.payment_status}});
    }catch(error){await connection.rollback();return next(error)}finally{connection.release()}
}

async function updateShipping(req,res,next){
    const {carrier,trackingNumber,note}=req.body||{};
    if(!validId(req.params.id)||typeof carrier!=='string'||carrier.trim().length<2||carrier.trim().length>100||
        typeof trackingNumber!=='string'||trackingNumber.trim().length<3||trackingNumber.trim().length>100||
        (note!=null&&(typeof note!=='string'||note.length>300)))return res.status(400).json({success:false,message:'Provide a carrier, tracking number and optional note.'});
    const connection=await pool.getConnection();
    try{
        await connection.beginTransaction();
        const [rows]=await connection.execute('SELECT id,user_id,order_code,status,shipping_carrier,tracking_number FROM orders WHERE id=? FOR UPDATE',[req.params.id]);
        const order=rows[0];
        if(!order){await connection.rollback();return res.status(404).json({success:false,message:'Order not found.'})}
        if(!['PROCESSING','SHIPPED'].includes(order.status)){await connection.rollback();return res.status(409).json({success:false,message:'Shipping details can be recorded only while an order is being prepared or shipped.'})}
        const cleanCarrier=carrier.trim(),cleanTracking=trackingNumber.trim();
        if(order.shipping_carrier===cleanCarrier&&order.tracking_number===cleanTracking){await connection.commit();return res.json({success:true,data:{carrier:cleanCarrier,trackingNumber:cleanTracking,unchanged:true}})}
        await connection.execute('UPDATE orders SET shipping_carrier=?,tracking_number=? WHERE id=?',[cleanCarrier,cleanTracking,order.id]);
        await connection.execute('INSERT INTO order_shipping_history (order_id,changed_by,carrier,tracking_number,note) VALUES (?,?,?,?,?)',[order.id,req.user.id,cleanCarrier,cleanTracking,note?.trim()||null]);
        await connection.execute("INSERT INTO notifications (user_id,type,title,body,order_id) VALUES (?,'SHIPPING','Thông tin giao hàng đã cập nhật',?,?)",[order.user_id,`Đơn ${order.order_code}: ${cleanCarrier} · mã ${cleanTracking}.`,order.id]);
        await connection.execute('INSERT INTO admin_audit_logs (admin_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,CAST(? AS JSON))',[req.user.id,'ORDER_SHIPPING','order',order.id,JSON.stringify({carrier:cleanCarrier,trackingNumber:cleanTracking,note:note?.trim()||null})]);
        await connection.commit();
        return res.json({success:true,data:{carrier:cleanCarrier,trackingNumber:cleanTracking,unchanged:false}});
    }catch(error){await connection.rollback();return next(error)}finally{connection.release()}
}

async function listCustomers(req,res,next){
    try{
        const page=Math.max(1,Number.parseInt(req.query.page,10)||1),limit=Math.min(100,Math.max(1,Number.parseInt(req.query.limit,10)||20));
        const q=req.query.q?`%${String(req.query.q).slice(0,100)}%`:'%';
        const [rows]=await pool.execute(`SELECT u.id,u.full_name,u.email,u.phone,u.role,u.status,u.created_at,COUNT(o.id) order_count,COALESCE(SUM(CASE WHEN o.payment_status='PAID' THEN o.total_amount ELSE 0 END),0) spend
            FROM users u LEFT JOIN orders o ON o.user_id=u.id WHERE u.email LIKE ? OR u.full_name LIKE ? GROUP BY u.id ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,[q,q,limit,(page-1)*limit]);
        const [[count]]=await pool.execute('SELECT COUNT(*) total FROM users WHERE email LIKE ? OR full_name LIKE ?',[q,q]);
        return res.json({success:true,data:{items:rows.map((r)=>({id:String(r.id),fullName:r.full_name,email:r.email,phone:r.phone,role:r.role,status:r.status,createdAt:r.created_at,orderCount:Number(r.order_count),spend:Number(r.spend)})),pagination:{page,limit,total:Number(count.total)}}});
    }catch(error){return next(error)}
}

async function setCustomerStatus(req,res,next){
    const status=req.body?.status;if(!['ACTIVE','LOCKED'].includes(status))return res.status(400).json({success:false,message:'Status must be ACTIVE or LOCKED.'});
    try{const [result]=await pool.execute('UPDATE users SET status=? WHERE id=? AND role<>\'ADMIN\'',[status,req.params.id]);if(!result.affectedRows)return res.status(404).json({success:false,message:'Customer not found or cannot be changed here.'});await audit(req.user.id,'CUSTOMER_STATUS','user',req.params.id,{status});return res.json({success:true})}catch(error){return next(error)}
}

async function setUserRole(req,res,next){
    const role=req.body?.role;if(!['USER','STAFF','ADMIN'].includes(role))return res.status(400).json({success:false,message:'Invalid role.'});
    const connection=await pool.getConnection();
    try{await connection.beginTransaction();const [rows]=await connection.execute('SELECT id,role,status FROM users WHERE id=? FOR UPDATE',[req.params.id]);if(!rows[0]){await connection.rollback();return res.status(404).json({success:false,message:'User not found.'})}
        if(rows[0].role==='ADMIN'&&role!=='ADMIN'&&rows[0].status==='ACTIVE'){const [admins]=await connection.query("SELECT id FROM users WHERE role='ADMIN' AND status='ACTIVE' FOR UPDATE");if(admins.length<=1){await connection.rollback();return res.status(409).json({success:false,message:'Cannot demote the last active administrator.'})}}
        await connection.execute('UPDATE users SET role=? WHERE id=?',[role,req.params.id]);await connection.execute('INSERT INTO admin_audit_logs (admin_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,CAST(? AS JSON))',[req.user.id,'USER_ROLE','user',req.params.id,JSON.stringify({role})]);await connection.commit();return res.json({success:true})
    }catch(error){await connection.rollback();return next(error)}finally{connection.release()}
}

async function listDeletionRequests(req,res,next){
    const status=typeof req.query.status==='string'&&['PENDING','REVIEWED','REJECTED'].includes(req.query.status)?req.query.status:null;
    const q=typeof req.query.q==='string'?`%${req.query.q.slice(0,100)}%`:'%';
    try{
        const [rows]=await pool.execute(`SELECT r.id,r.user_id,r.status,r.reason,r.admin_note,r.reviewed_by,r.created_at,r.updated_at,u.full_name,u.email,reviewer.full_name reviewer_name
            FROM account_deletion_requests r JOIN users u ON u.id=r.user_id LEFT JOIN users reviewer ON reviewer.id=r.reviewed_by
            WHERE (? IS NULL OR r.status=?) AND (u.email LIKE ? OR u.full_name LIKE ?)
            ORDER BY r.created_at DESC,r.id DESC LIMIT 200`,[status,status,q,q]);
        return res.json({success:true,data:rows.map(row=>({id:String(row.id),userId:String(row.user_id),fullName:row.full_name,email:row.email,status:row.status,reason:row.reason,adminNote:row.admin_note,reviewedBy:row.reviewed_by==null?null:String(row.reviewed_by),reviewerName:row.reviewer_name,createdAt:row.created_at,updatedAt:row.updated_at}))});
    }catch(error){return next(error)}
}

async function reviewDeletionRequest(req,res,next){
    const {status,adminNote}=req.body||{};
    if(!/^\d+$/.test(String(req.params.id||''))||!['REVIEWED','REJECTED'].includes(status)||typeof adminNote!=='string'||!adminNote.trim()||adminNote.trim().length>1000)return res.status(400).json({success:false,message:'Choose a review outcome and provide a note for the customer.'});
    const connection=await pool.getConnection();
    try{
        await connection.beginTransaction();
        const [rows]=await connection.execute('SELECT id,user_id,status FROM account_deletion_requests WHERE id=? FOR UPDATE',[req.params.id]);
        const request=rows[0];
        if(!request){await connection.rollback();return res.status(404).json({success:false,message:'Deletion request not found.'})}
        if(request.status!=='PENDING'){await connection.rollback();return res.status(409).json({success:false,message:'This request has already been reviewed.'})}
        await connection.execute('UPDATE account_deletion_requests SET status=?,admin_note=?,reviewed_by=? WHERE id=?',[status,adminNote.trim(),req.user.id,request.id]);
        await connection.execute("INSERT INTO notifications (user_id,type,title,body) VALUES (?,'ACCOUNT',?,?)",[request.user_id,'Cập nhật yêu cầu tài khoản',adminNote.trim()]);
        await connection.execute('INSERT INTO admin_audit_logs (admin_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,CAST(? AS JSON))',[req.user.id,'ACCOUNT_DELETION_REVIEW','account_deletion_request',request.id,JSON.stringify({status,adminNote:adminNote.trim()})]);
        await connection.commit();
        return res.json({success:true,data:{id:String(request.id),status,adminNote:adminNote.trim()}});
    }catch(error){await connection.rollback();return next(error)}finally{connection.release()}
}
async function listCoupons(req,res,next){
    try{
        const [rows]=await pool.query(`SELECT c.*,DATE_FORMAT(c.starts_at,'%Y-%m-%dT%H:%i:%s') starts_at,
            DATE_FORMAT(c.ends_at,'%Y-%m-%dT%H:%i:%s') ends_at FROM coupons c ORDER BY c.created_at DESC`);
        const [categoryRows]=await pool.query(`SELECT cc.coupon_id,cc.category_id,c.name FROM coupon_categories cc
            JOIN categories c ON c.id=cc.category_id ORDER BY c.sort_order,c.name`);
        const related=new Map();
        for(const row of categoryRows){const key=String(row.coupon_id);if(!related.has(key))related.set(key,[]);related.get(key).push({id:String(row.category_id),name:row.name})}
        return res.json({success:true,data:rows.map((row)=>couponView(row,related.get(String(row.id))||[]))});
    }catch(error){return next(error)}
}
function couponView(r,related=[]){return{id:String(r.id),code:r.code,discountType:r.discount_type,discountValue:Number(r.discount_value),maxDiscount:r.max_discount==null?null:Number(r.max_discount),minSubtotal:Number(r.min_subtotal),startsAt:r.starts_at,endsAt:r.ends_at,usageLimit:r.usage_limit,perUserLimit:Number(r.per_user_limit),usedCount:Number(r.used_count),isActive:Boolean(r.is_active),categoryIds:related.map((category)=>category.id),categoryNames:related.map((category)=>category.name)}}
async function saveCoupon(req,res,next){
    const b=req.body||{},code=typeof b.code==='string'?b.code.trim().toUpperCase():'';
    const discount=Number(b.discountValue),minimum=Number(b.minSubtotal??0);
    const maximum=b.maxDiscount==null||b.maxDiscount===''?null:Number(b.maxDiscount);
    const usage=b.usageLimit==null||b.usageLimit===''?null:Number(b.usageLimit);
    const perUser=Number(b.perUserLimit??1);
    const categoryInput=b.categoryIds===undefined?[]:b.categoryIds;
    const categoryIds=Array.isArray(categoryInput)?categoryInput.map(String):[];
    const parseDate=(value)=>{
        if(!value)return null;
        if(typeof value!=='string')return undefined;
        const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
        if(!match)return undefined;
        const [,year,month,day,hour,minute,second='00']=match.map((part)=>part||'00');
        const date=new Date(Date.UTC(Number(year),Number(month)-1,Number(day),Number(hour),Number(minute),Number(second)));
        if(Number(year)<1000||date.getUTCFullYear()!==Number(year)||date.getUTCMonth()+1!==Number(month)||date.getUTCDate()!==Number(day)||
            date.getUTCHours()!==Number(hour)||date.getUTCMinutes()!==Number(minute)||date.getUTCSeconds()!==Number(second))return undefined;
        return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    };
    const startsAt=parseDate(b.startsAt),endsAt=parseDate(b.endsAt);
    if(!/^[A-Z0-9_-]{3,40}$/.test(code)||!['PERCENT','FIXED'].includes(b.discountType)||!Number.isFinite(discount)||discount<=0||
        (b.discountType==='PERCENT'&&discount>100)||!Number.isFinite(minimum)||minimum<0||
        (maximum!==null&&(!Number.isFinite(maximum)||maximum<=0))||(usage!==null&&(!Number.isInteger(usage)||usage<1))||
        !Number.isInteger(perUser)||perUser<1||perUser>1000||startsAt===undefined||endsAt===undefined||
        !Array.isArray(categoryInput)||categoryIds.length>50||categoryIds.some((id)=>!validId(id))||new Set(categoryIds).size!==categoryIds.length||
        (req.params.id&&!validId(req.params.id))||
        (startsAt&&endsAt&&Date.parse(startsAt)>=Date.parse(endsAt))||
        (b.isActive!==undefined&&typeof b.isActive!=='boolean')){
        return res.status(400).json({success:false,message:'Invalid coupon configuration.'});
    }
    const values=[code,b.discountType,discount,maximum,minimum,startsAt,endsAt,usage,perUser,b.isActive===false?0:1];
    const connection=await pool.getConnection();
    try{
        await connection.beginTransaction();
        if(categoryIds.length){
            const [categories]=await connection.execute(`SELECT id FROM categories WHERE id IN (${categoryIds.map(()=>'?').join(',')})`,categoryIds);
            if(categories.length!==categoryIds.length){await connection.rollback();return res.status(400).json({success:false,message:'One or more coupon categories do not exist.'})}
        }
        let couponId;
        if(req.params.id){
            const [[current]]=await connection.execute('SELECT id FROM coupons WHERE id=? FOR UPDATE',[req.params.id]);
            if(!current){await connection.rollback();return res.status(404).json({success:false,message:'Coupon not found.'})}
            couponId=current.id;
            await connection.execute('UPDATE coupons SET code=?,discount_type=?,discount_value=?,max_discount=?,min_subtotal=?,starts_at=?,ends_at=?,usage_limit=?,per_user_limit=?,is_active=? WHERE id=?',[...values,couponId]);
            await connection.execute('DELETE FROM coupon_categories WHERE coupon_id=?',[couponId]);
        }else{
            const [result]=await connection.execute('INSERT INTO coupons (code,discount_type,discount_value,max_discount,min_subtotal,starts_at,ends_at,usage_limit,per_user_limit,is_active) VALUES (?,?,?,?,?,?,?,?,?,?)',values);
            couponId=result.insertId;
        }
        for(const categoryId of categoryIds)await connection.execute('INSERT INTO coupon_categories (coupon_id,category_id) VALUES (?,?)',[couponId,categoryId]);
        await connection.execute('INSERT INTO admin_audit_logs (admin_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,CAST(? AS JSON))',
            [req.user.id,req.params.id?'COUPON_UPDATE':'COUPON_CREATE','coupon',couponId,JSON.stringify({code,categoryIds})]);
        await connection.commit();
        return res.status(req.params.id?200:201).json({success:true,data:{id:String(couponId),code,categoryIds}});
    }catch(error){
        await connection.rollback();
        if(error.code==='ER_DUP_ENTRY')return res.status(409).json({success:false,message:'Coupon code already exists.'});
        return next(error);
    }finally{connection.release()}
}
async function archiveCoupon(req,res,next){try{const [result]=await pool.execute('UPDATE coupons SET is_active=0 WHERE id=?',[req.params.id]);if(!result.affectedRows)return res.status(404).json({success:false,message:'Coupon not found.'});await audit(req.user.id,'COUPON_ARCHIVE','coupon',req.params.id,null);return res.json({success:true})}catch(error){return next(error)}}

async function listReturns(req,res,next){
    try{const [rows]=await pool.execute(`SELECT r.*,o.order_code,u.full_name,u.email FROM return_requests r JOIN orders o ON o.id=r.order_id JOIN users u ON u.id=r.user_id
        ${req.query.status&&['PENDING','APPROVED','REJECTED','COMPLETED'].includes(req.query.status)?'WHERE r.status=?':''} ORDER BY r.created_at DESC LIMIT 200`,req.query.status&&['PENDING','APPROVED','REJECTED','COMPLETED'].includes(req.query.status)?[req.query.status]:[]);
        return res.json({success:true,data:rows.map(r=>({id:String(r.id),orderId:String(r.order_id),orderCode:r.order_code,userId:String(r.user_id),customer:r.full_name,email:r.email,reason:r.reason,details:r.details,status:r.status,adminNote:r.admin_note,createdAt:r.created_at}))})
    }catch(error){return next(error)}
}
async function updateReturn(req,res,next){
    const {status,adminNote}=req.body||{};
    if(!['APPROVED','REJECTED','COMPLETED'].includes(status)||(adminNote!=null&&(typeof adminNote!=='string'||adminNote.length>1000)))return res.status(400).json({success:false,message:'Invalid return request decision.'});
    const connection=await pool.getConnection();
    try{
        await connection.beginTransaction();
        const [rows]=await connection.execute('SELECT * FROM return_requests WHERE id=? FOR UPDATE',[req.params.id]);
        const request=rows[0];
        if(!request){await connection.rollback();return res.status(404).json({success:false,message:'Return request not found.'})}
        if(request.status!=='PENDING'&&!(request.status==='APPROVED'&&status==='COMPLETED')){await connection.rollback();return res.status(409).json({success:false,message:'This return request has already been resolved.'})}
        if(status==='COMPLETED'){
            const [items]=await connection.execute('SELECT product_id,quantity FROM order_items WHERE order_id=? AND product_id IS NOT NULL',[request.order_id]);
            for(const item of items){
                await connection.execute('UPDATE products SET stock=stock+? WHERE id=?',[item.quantity,item.product_id]);
                await connection.execute("INSERT INTO inventory_movements (product_id,changed_by,quantity_delta,reason,order_id) VALUES (?,?,?,'Return completed; stock restocked',?)",[item.product_id,req.user.id,item.quantity,request.order_id]);
            }
        }
        await connection.execute('UPDATE return_requests SET status=?,admin_note=? WHERE id=?',[status,adminNote?.trim()||null,request.id]);
        await connection.execute("INSERT INTO notifications (user_id,type,title,body,order_id) VALUES (?,'RETURN','Cập nhật yêu cầu đổi trả',?,?)",[request.user_id,adminNote?.trim()||`Yêu cầu đổi trả: ${status}.`,request.order_id]);
        await connection.execute('INSERT INTO admin_audit_logs (admin_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,CAST(? AS JSON))',[req.user.id,'RETURN_DECISION','return',request.id,JSON.stringify({status,adminNote:adminNote||null,restocked:status==='COMPLETED'})]);
        await connection.commit();
        return res.json({success:true,data:{id:String(request.id),status,restocked:status==='COMPLETED'}});
    }catch(error){await connection.rollback();return next(error)}finally{connection.release()}
}
async function listReviews(req,res,next){try{const [rows]=await pool.query(`SELECT r.*,p.name product_name,u.full_name customer FROM reviews r JOIN products p ON p.id=r.product_id JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC LIMIT 200`);return res.json({success:true,data:rows.map(r=>({id:String(r.id),productId:String(r.product_id),productName:r.product_name,userId:String(r.user_id),customer:r.customer,rating:Number(r.rating),body:r.body,isApproved:Boolean(r.is_approved),createdAt:r.created_at}))})}catch(error){return next(error)}}
async function moderateReview(req,res,next){const isApproved=req.body?.isApproved;if(typeof isApproved!=='boolean')return res.status(400).json({success:false,message:'isApproved must be boolean.'});try{const [result]=await pool.execute('UPDATE reviews SET is_approved=? WHERE id=?',[isApproved,req.params.id]);if(!result.affectedRows)return res.status(404).json({success:false,message:'Review not found.'});await audit(req.user.id,'REVIEW_MODERATE','review',req.params.id,{isApproved});return res.json({success:true})}catch(error){return next(error)}}

async function audit(adminId,action,type,id,details){await pool.execute('INSERT INTO admin_audit_logs (admin_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)',[adminId,action,type,id,details?JSON.stringify(details):null])}
module.exports={dashboard,listProducts,createProduct,updateProduct,archiveProduct,adjustInventory,listInventory,listCategories,saveCategory,archiveCategory,listBanners,createBanner,updateBanner,archiveBanner,listOrders,adminOrderDetail,updateOrderStatus,updateShipping,listCustomers,setCustomerStatus,setUserRole,listDeletionRequests,reviewDeletionRequest,listCoupons,saveCoupon,archiveCoupon,listReturns,updateReturn,listReviews,moderateReview};
