const express=require('express');
const review=require('../controllers/reviewController');
const {requireAuth}=require('../middleware/authMiddleware');
const router=express.Router();
router.use(requireAuth);
router.put('/:id',review.updateOwn);
router.delete('/:id',review.deleteOwn);
module.exports=router;
