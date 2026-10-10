const pool=require('../config/db');

async function listForProduct(req,res,next){
    try{
        const page=Math.max(1,Number.parseInt(req.query.page,10)||1),limit=Math.min(50,Math.max(1,Number.parseInt(req.query.limit,10)||10));
        const [rows]=await pool.execute(`SELECT r.id,r.rating,r.body,r.created_at,u.full_name FROM reviews r JOIN users u ON u.id=r.user_id
            WHERE r.product_id=? AND r.is_approved=1 ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,[req.params.id,limit,(page-1)*limit]);
        const [[stats]]=await pool.execute('SELECT AVG(rating) average,COUNT(*) total FROM reviews WHERE product_id=? AND is_approved=1',[req.params.id]);
        const [counts]=await pool.execute('SELECT rating,COUNT(*) total FROM reviews WHERE product_id=? AND is_approved=1 GROUP BY rating',[req.params.id]);
        const distribution={1:0,2:0,3:0,4:0,5:0};for(const row of counts)distribution[row.rating]=Number(row.total);
        return res.json({success:true,data:{items:rows.map((r)=>({id:String(r.id),rating:Number(r.rating),body:r.body,author:r.full_name,createdAt:r.created_at})),averageRating:Number(stats.average||0),distribution,total:Number(stats.total),page,limit}});
    }catch(error){return next(error)}
}

async function create(req,res,next){
    const rating=Number(req.body?.rating);const body=req.body?.body;
    if(!Number.isInteger(rating)||rating<1||rating>5||(body!=null&&(typeof body!=='string'||body.length>2000)))return res.status(400).json({success:false,message:'Rating must be 1–5 stars; review text may be up to 2000 characters.'});
    try{
        const [[purchase]]=await pool.execute(`SELECT o.id FROM orders o JOIN order_items oi ON oi.order_id=o.id
            WHERE o.id=? AND o.user_id=? AND oi.product_id=? AND o.status='DELIVERED' LIMIT 1`,[req.body?.orderId,req.user.id,req.params.id]);
        if(!purchase)return res.status(403).json({success:false,message:'Reviews are available only for products in delivered orders.'});
        await pool.execute(`INSERT INTO reviews (user_id,product_id,order_id,rating,body) VALUES (?,?,?,?,?)
            ON DUPLICATE KEY UPDATE rating=VALUES(rating),body=VALUES(body),is_approved=0`,[req.user.id,req.params.id,purchase.id,rating,body?.trim()||null]);
        return res.status(201).json({success:true,message:'Review saved.'});
    }catch(error){return next(error)}
}

async function updateOwn(req,res,next){
    const rating=Number(req.body?.rating),body=req.body?.body;
    if(!Number.isInteger(rating)||rating<1||rating>5||(body!=null&&(typeof body!=='string'||body.length>2000)))return res.status(400).json({success:false,message:'Invalid review.'});
    try{const [result]=await pool.execute('UPDATE reviews SET rating=?,body=?,is_approved=0 WHERE id=? AND user_id=?',[rating,body?.trim()||null,req.params.id,req.user.id]);if(!result.affectedRows)return res.status(404).json({success:false,message:'Review not found.'});return res.json({success:true})}catch(error){return next(error)}
}

async function deleteOwn(req,res,next){
    try{const [result]=await pool.execute('DELETE FROM reviews WHERE id=? AND user_id=?',[req.params.id,req.user.id]);if(!result.affectedRows)return res.status(404).json({success:false,message:'Review not found.'});return res.json({success:true})}catch(error){return next(error)}
}
module.exports={listForProduct,create,updateOwn,deleteOwn};
