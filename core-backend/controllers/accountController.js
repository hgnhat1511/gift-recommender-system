const bcrypt = require('bcryptjs');
const pool = require('../config/db');

async function profile(req, res, next) {
    try {
        const [rows] = await pool.execute('SELECT id,full_name,email,phone,role,status,created_at FROM users WHERE id=?', [req.user.id]);
        if (!rows[0]) return res.status(404).json({ success: false, message: 'Account not found.' });
        const row = rows[0];
        return res.json({ success: true, data: { user: { id: String(row.id), fullName: row.full_name, email: row.email, phone: row.phone, role: row.role, status: row.status, createdAt: row.created_at } } });
    } catch (error) { return next(error); }
}

async function updateProfile(req, res, next) {
    try {
        const { fullName, phone } = req.body || {};
        if (typeof fullName !== 'string' || !fullName.trim() || fullName.trim().length > 100 ||
            (phone != null && (typeof phone !== 'string' || phone.length > 20))) {
            return res.status(400).json({ success: false, message: 'Invalid profile details.' });
        }
        await pool.execute('UPDATE users SET full_name=?,phone=? WHERE id=?', [fullName.trim(), phone?.trim() || null, req.user.id]);
        return profile(req, res, next);
    } catch (error) { return next(error); }
}

async function changePassword(req, res, next) {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body || {};
        if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 8 ||
            Buffer.byteLength(newPassword, 'utf8') > 72 || newPassword !== confirmPassword) {
            return res.status(400).json({ success: false, message: 'Provide a valid new password and confirmation.' });
        }
        const [rows] = await pool.execute('SELECT password_hash FROM users WHERE id=?', [req.user.id]);
        if (!rows[0] || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
            return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
        }
        await pool.execute('UPDATE users SET password_hash=? WHERE id=?', [await bcrypt.hash(newPassword, 12), req.user.id]);
        return res.json({ success: true, message: 'Password updated. Previously issued JWTs remain valid until they expire.' });
    } catch (error) { return next(error); }
}

const addressFields = ['recipientName','phone','addressLine','ward','district','city'];
function validateAddress(body) {
    if (!body || addressFields.some((field) => ['recipientName','phone','addressLine','city'].includes(field) && (typeof body[field] !== 'string' || !body[field].trim()))) return false;
    return body.recipientName.length <= 120 && body.phone.length <= 30 && body.addressLine.length <= 255 &&
        body.city.length <= 100 && (body.ward == null || (typeof body.ward === 'string' && body.ward.length <= 100)) &&
        (body.district == null || (typeof body.district === 'string' && body.district.length <= 100));
}

async function listAddresses(req, res, next) {
    try {
        const [rows] = await pool.execute('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC,id DESC', [req.user.id]);
        return res.json({ success: true, data: rows.map(addressView) });
    } catch (error) { return next(error); }
}

function addressView(row) {
    return { id: String(row.id), recipientName: row.recipient_name, phone: row.phone, addressLine: row.address_line,
        ward: row.ward, district: row.district, city: row.city, isDefault: Boolean(row.is_default) };
}

async function createAddress(req, res, next) {
    if (!validateAddress(req.body)) return res.status(400).json({ success: false, message: 'Invalid delivery address.' });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [[count]] = await connection.execute('SELECT COUNT(*) total FROM addresses WHERE user_id=? FOR UPDATE', [req.user.id]);
        if (Number(count.total) >= 20) { await connection.rollback(); return res.status(400).json({ success: false, message: 'You can save up to 20 addresses.' }); }
        const isDefault = Boolean(req.body.isDefault) || Number(count.total) === 0;
        if (isDefault) await connection.execute('UPDATE addresses SET is_default=0 WHERE user_id=?', [req.user.id]);
        const [created] = await connection.execute(`INSERT INTO addresses (user_id,recipient_name,phone,address_line,ward,district,city,is_default)
            VALUES (?,?,?,?,?,?,?,?)`, [req.user.id,req.body.recipientName.trim(),req.body.phone.trim(),req.body.addressLine.trim(),req.body.ward?.trim() || null,req.body.district?.trim() || null,req.body.city.trim(),isDefault]);
        await connection.commit();
        const [[row]] = await pool.execute('SELECT * FROM addresses WHERE id=? AND user_id=?', [created.insertId,req.user.id]);
        return res.status(201).json({ success: true, data: addressView(row) });
    } catch (error) { await connection.rollback(); return next(error); }
    finally { connection.release(); }
}

async function updateAddress(req, res, next) {
    if (!validateAddress(req.body)) return res.status(400).json({ success: false, message: 'Invalid delivery address.' });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [owned] = await connection.execute('SELECT id FROM addresses WHERE id=? AND user_id=? FOR UPDATE', [req.params.id,req.user.id]);
        if (!owned[0]) { await connection.rollback(); return res.status(404).json({ success: false, message: 'Address not found.' }); }
        if (req.body.isDefault) await connection.execute('UPDATE addresses SET is_default=0 WHERE user_id=?', [req.user.id]);
        await connection.execute(`UPDATE addresses SET recipient_name=?,phone=?,address_line=?,ward=?,district=?,city=?,is_default=IF(?,1,is_default)
            WHERE id=? AND user_id=?`, [req.body.recipientName.trim(),req.body.phone.trim(),req.body.addressLine.trim(),req.body.ward?.trim() || null,req.body.district?.trim() || null,req.body.city.trim(),Boolean(req.body.isDefault),req.params.id,req.user.id]);
        await connection.commit();
        const [[row]] = await pool.execute('SELECT * FROM addresses WHERE id=? AND user_id=?', [req.params.id,req.user.id]);
        return res.json({ success: true, data: addressView(row) });
    } catch (error) { await connection.rollback(); return next(error); }
    finally { connection.release(); }
}

async function deleteAddress(req, res, next) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [rows] = await connection.execute('SELECT id,is_default FROM addresses WHERE id=? AND user_id=? FOR UPDATE', [req.params.id,req.user.id]);
        if (!rows[0]) { await connection.rollback(); return res.status(404).json({ success: false, message: 'Address not found.' }); }
        await connection.execute('DELETE FROM addresses WHERE id=? AND user_id=?', [req.params.id,req.user.id]);
        if (rows[0].is_default) {
            const [nextAddress] = await connection.execute('SELECT id FROM addresses WHERE user_id=? ORDER BY id LIMIT 1 FOR UPDATE', [req.user.id]);
            if (nextAddress[0]) await connection.execute('UPDATE addresses SET is_default=1 WHERE id=?', [nextAddress[0].id]);
        }
        await connection.commit();
        return res.json({ success: true });
    } catch (error) { await connection.rollback(); return next(error); }
    finally { connection.release(); }
}

async function setDefaultAddress(req, res, next) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [rows] = await connection.execute('SELECT id FROM addresses WHERE id=? AND user_id=? FOR UPDATE', [req.params.id,req.user.id]);
        if (!rows[0]) { await connection.rollback(); return res.status(404).json({ success: false, message: 'Address not found.' }); }
        await connection.execute('UPDATE addresses SET is_default=(id=?) WHERE user_id=?', [req.params.id,req.user.id]);
        await connection.commit();
        return res.json({ success: true });
    } catch (error) { await connection.rollback(); return next(error); }
    finally { connection.release(); }
}

async function favorites(req, res, next) {
    try {
        const [rows] = await pool.execute(`SELECT p.*,c.name category_name,0 average_rating,0 review_count FROM favorites f
            JOIN products p ON p.id=f.product_id LEFT JOIN categories c ON c.id=p.category_id
            WHERE f.user_id=? AND p.status='ACTIVE' ORDER BY f.created_at DESC`, [req.user.id]);
        const { present } = require('./catalogController');
        return res.json({ success: true, data: rows.map(present) });
    } catch (error) { return next(error); }
}

async function reviewHistory(req, res, next) {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
        return res.status(400).json({ success:false,message:'Review page and limit are invalid.' });
    }
    try {
        const [rows] = await pool.execute(`SELECT r.id,r.product_id,r.order_id,r.rating,r.body,r.is_approved,r.created_at,r.updated_at,
                p.name product_name,p.image_url,o.order_code
            FROM reviews r
            JOIN products p ON p.id=r.product_id
            JOIN orders o ON o.id=r.order_id
            WHERE r.user_id=?
            ORDER BY r.updated_at DESC,r.id DESC
            LIMIT ? OFFSET ?`, [req.user.id,limit,(page-1)*limit]);
        const [[count]] = await pool.execute('SELECT COUNT(*) total FROM reviews WHERE user_id=?', [req.user.id]);
        return res.json({ success:true,data:{
            items:rows.map((row)=>({
                id:String(row.id),productId:String(row.product_id),productName:row.product_name,imageUrl:row.image_url,
                orderId:String(row.order_id),orderCode:row.order_code,rating:Number(row.rating),body:row.body,
                isApproved:Boolean(row.is_approved),createdAt:row.created_at,updatedAt:row.updated_at
            })),
            pagination:{page,limit,total:Number(count.total),pages:Math.ceil(Number(count.total)/limit)}
        }});
    } catch (error) { return next(error); }
}

async function toggleFavorite(req, res, next) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [[product]] = await connection.execute("SELECT id FROM products WHERE id=? AND status='ACTIVE'", [req.params.productId]);
        if (!product) { await connection.rollback(); return res.status(404).json({ success: false, message: 'Product not found.' }); }
        const [existing] = await connection.execute('SELECT 1 FROM favorites WHERE user_id=? AND product_id=?', [req.user.id,req.params.productId]);
        if (existing.length) await connection.execute('DELETE FROM favorites WHERE user_id=? AND product_id=?', [req.user.id,req.params.productId]);
        else await connection.execute('INSERT INTO favorites (user_id,product_id) VALUES (?,?)', [req.user.id,req.params.productId]);
        await connection.execute("INSERT INTO product_events (user_id,product_id,event_type) VALUES (?,?,'FAVORITE')", [req.user.id,req.params.productId]);
        await connection.commit();
        return res.json({ success: true, data: { favorite: !existing.length } });
    } catch (error) { await connection.rollback(); return next(error); }
    finally { connection.release(); }
}

function deletionRequestView(row){return{id:String(row.id),status:row.status,reason:row.reason,adminNote:row.admin_note,createdAt:row.created_at,updatedAt:row.updated_at}}

async function getDeletionRequest(req,res,next){
    try{const [[row]]=await pool.execute('SELECT id,status,reason,admin_note,created_at,updated_at FROM account_deletion_requests WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 1',[req.user.id]);return res.json({success:true,data:row?deletionRequestView(row):null})}
    catch(error){return next(error)}
}

async function createDeletionRequest(req,res,next){
    const {currentPassword,reason}=req.body||{};
    if(typeof currentPassword!=='string'||!currentPassword||Buffer.byteLength(currentPassword,'utf8')>72||
        (reason!=null&&(typeof reason!=='string'||reason.length>1000)))return res.status(400).json({success:false,message:'Confirm your current password and provide an optional reason.'});
    const connection=await pool.getConnection();
    try{
        await connection.beginTransaction();
        const [users]=await connection.execute('SELECT id,password_hash,status FROM users WHERE id=? FOR UPDATE',[req.user.id]);
        if(!users[0]||users[0].status!=='ACTIVE'){await connection.rollback();return res.status(401).json({success:false,message:'Account is not active.'})}
        if(!(await bcrypt.compare(currentPassword,users[0].password_hash))){await connection.rollback();return res.status(401).json({success:false,message:'Current password is incorrect.'})}
        const [[pending]]=await connection.execute("SELECT id FROM account_deletion_requests WHERE user_id=? AND status='PENDING' ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE",[req.user.id]);
        if(pending){await connection.rollback();return res.status(409).json({success:false,message:'You already have a pending account deletion request.'})}
        const [created]=await connection.execute('INSERT INTO account_deletion_requests (user_id,reason) VALUES (?,?)',[req.user.id,reason?.trim()||null]);
        await connection.commit();
        const [[row]]=await pool.execute('SELECT id,status,reason,admin_note,created_at,updated_at FROM account_deletion_requests WHERE id=?',[created.insertId]);
        return res.status(201).json({success:true,data:deletionRequestView(row)});
    }catch(error){await connection.rollback();return next(error)}finally{connection.release()}
}
async function listNotifications(req, res, next) {
    try {
        const [rows] = await pool.execute('SELECT id,type,title,body,order_id,read_at,created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100', [req.user.id]);
        return res.json({ success: true, data: rows.map((row) => ({ id:String(row.id), type:row.type, title:row.title, body:row.body, orderId:row.order_id == null ? null : String(row.order_id), readAt:row.read_at, createdAt:row.created_at })) });
    } catch (error) { return next(error); }
}

async function markNotificationRead(req, res, next) {
    try {
        const [result] = await pool.execute('UPDATE notifications SET read_at=COALESCE(read_at,NOW()) WHERE id=? AND user_id=?', [req.params.id,req.user.id]);
        if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Notification not found.' });
        return res.json({ success: true });
    } catch (error) { return next(error); }
}

module.exports = { profile, updateProfile, changePassword, listAddresses, createAddress, updateAddress, deleteAddress, setDefaultAddress, favorites, reviewHistory, toggleFavorite, getDeletionRequest, createDeletionRequest, listNotifications, markNotificationRead };
