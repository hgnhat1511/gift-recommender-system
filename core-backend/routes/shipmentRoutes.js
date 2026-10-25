const express=require('express');
const {ghnWebhook}=require('../controllers/shipmentController');
const router=express.Router();
router.post('/ghn/webhook',express.json({limit:'32kb'}),ghnWebhook);
module.exports=router;
