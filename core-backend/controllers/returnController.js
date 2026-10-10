const pool=require('../config/db');

async function create(req,res,next){
    const {reason,details}=req.body||{};
    if(typeof reason!=='string'||!reason.trim()||reason.length>120||(details!=null&&(typeof details!=='string'||details.length>1000)))return res.status(400).json({success:false,message:'Provide a return reason and optional details.'});
    const connection=await pool.getConnection();
    let inTransaction=false;
    try{
        await connection.beginTransaction();inTransaction=true;
        const [orders]=await connection.execute("SELECT id FROM orders WHERE id=? AND user_id=? AND status='DELIVERED' FOR UPDATE",[req.params.id,req.user.id]);
        const order=orders[0];
        if(!order){await connection.rollback();inTransaction=false;return res.status(409).json({success:false,message:'Return requests are available for delivered orders.'})}
        const [[existing]]=await connection.execute("SELECT id FROM return_requests WHERE order_id=? AND status IN ('PENDING','APPROVED','COMPLETED') LIMIT 1",[order.id]);
        if(existing){await connection.rollback();inTransaction=false;return res.status(409).json({success:false,message:'This order already has a return request that prevents another submission.'})}
        const [result]=await connection.execute('INSERT INTO return_requests (order_id,user_id,reason,details) VALUES (?,?,?,?)',[order.id,req.user.id,reason.trim(),details?.trim()||null]);
        await connection.execute("INSERT INTO notifications (user_id,type,title,body,order_id) VALUES (?,'RETURN','Đã nhận yêu cầu đổi trả','Yêu cầu đổi trả đang chờ được xem xét.',?)",[req.user.id,order.id]);
        await connection.commit();inTransaction=false;
        return res.status(201).json({success:true,data:{id:String(result.insertId),status:'PENDING'}});
    }catch(error){if(inTransaction)await connection.rollback();return next(error)}finally{connection.release()}
}

async function listMine(req,res,next){
    try{const [rows]=await pool.execute('SELECT id,order_id,reason,details,status,admin_note,created_at,updated_at FROM return_requests WHERE order_id=? AND user_id=? ORDER BY created_at DESC',[req.params.id,req.user.id]);return res.json({success:true,data:rows.map((r)=>({id:String(r.id),orderId:String(r.order_id),reason:r.reason,details:r.details,status:r.status,adminNote:r.admin_note,createdAt:r.created_at,updatedAt:r.updated_at}))})}catch(error){return next(error)}
}
module.exports={create,listMine};
