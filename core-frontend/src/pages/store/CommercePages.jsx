import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, Minus, Package, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import api, { getApiError, getAuth } from '../../lib/api.js';
import { beginGuestCartMerge, clearGuestCart, clearGuestCartMergePending, completeGuestCartMerge, getGuestCart, getPendingGuestCartMerge, removeGuestCartItem, setGuestCartAllSelected, updateGuestCartItem } from '../../lib/guestCart.js';
import { emitCartChange } from '../../context/CartContext.jsx';
import { buildUpdateCartItemPayload, buildUpdateSelectionPayload, buildUpdateAllSelectionPayload, buildCreateOrderPayload } from '../../lib/cartPayloads.js';
import { getOrderStatusLabel, getPaymentStatusLabel, getPaymentMethodLabel, getReturnStatusLabel, getShippingMethodLabel, getOrderHistoryNoteLabel, ORDER_RECEIPT_LABEL } from '../../lib/labels.js';
import { money } from '../../data/catalogOptions.js';
import './commerce.css';

function PageHeading({title,subtitle}){return <div className="commerce-page-heading"><div><span className="commerce-kicker">GIFTLY</span><h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div></div>}

export function CartPage(){
  const location=useLocation();
  const authenticated=Boolean(getAuth()?.token);
  const [cart,setCart]=useState(null);
  const [guestItems,setGuestItems]=useState(getGuestCart);
  const [guestProducts,setGuestProducts]=useState({});
  const [loading,setLoading]=useState(Boolean(getAuth()?.token));
  const [error,setError]=useState('');
  const [notice,setNotice]=useState(location.state?.message||'');
  const [mergeBusy,setMergeBusy]=useState(false);
  const [mergePending,setMergePending]=useState(Boolean(getPendingGuestCartMerge()));
  const reorderResult=location.state?.reorderResult;
  const guestIds=guestItems.map(item=>item.productId);
  const guestKey=guestIds.join(',');
  const guestRows=guestItems.map(item=>{const product=guestProducts[item.productId]||null;return {cartItemId:item.productId,quantity:item.quantity,selected:item.selected,product,available:Boolean(product&&product.stock>=item.quantity),isGuest:true}});
  const visibleItems=authenticated?(cart?.items||[]):guestRows;
  const selectedItems=visibleItems.filter(item=>item.selected);
  const selectedUnavailable=selectedItems.some(item=>!item.available);
  const subtotal=authenticated?Number(cart?.subtotal||0):selectedItems.reduce((total,item)=>total+(item.product?.price||0)*item.quantity,0);

  async function load(){setLoading(true);try{const {data}=await api.get('/cart');setCart(data.data)}catch(e){setError(getApiError(e,'Không tải được giỏ hàng.'))}finally{setLoading(false)}}
  useEffect(()=>{
    if(!authenticated)return;
    let active=true;
    api.get('/cart').then(({data})=>{if(active)setCart(data.data)}).catch(e=>{if(active)setError(getApiError(e,'Không tải được giỏ hàng.'))}).finally(()=>{if(active)setLoading(false)});
    return()=>{active=false};
  },[authenticated]);
  useEffect(()=>{
    if(!guestKey)return;
    let active=true;
    api.get('/products/lookup',{params:{ids:guestKey}}).then(({data})=>{if(active)setGuestProducts(Object.fromEntries(data.data.map(product=>[product.id,product])))})
      .catch(()=>{if(active)setGuestProducts({})});
    return()=>{active=false};
  },[guestKey]);

  function syncGuest(){setGuestItems(getGuestCart());setMergePending(Boolean(getPendingGuestCartMerge()))}
  async function update(item,quantity){
    const qty=Math.max(1,Math.min(item.product?.stock||99,Math.min(99,quantity)));
    setError('');
    if(item.isGuest){updateGuestCartItem(item.cartItemId,{quantity:qty});syncGuest();return}
    try{await api.patch('/cart/items/'+item.cartItemId,buildUpdateCartItemPayload(qty));emitCartChange();await load()}catch(e){setError(getApiError(e,'Không cập nhật được số lượng.'));await load()}
  }
  async function selectItem(item,isSelected){
    setError('');
    if(item.isGuest){updateGuestCartItem(item.cartItemId,{selected:isSelected});syncGuest();return}
    try{await api.patch('/cart/items/'+item.cartItemId+'/selection',buildUpdateSelectionPayload(isSelected));emitCartChange();await load()}catch(e){setError(getApiError(e,'Không thể thay đổi lựa chọn.'))}
  }
  async function selectAll(isSelected){
    setError('');
    if(authenticated){
      try{await api.patch('/cart/selection',buildUpdateAllSelectionPayload(isSelected));emitCartChange();await load()}catch(e){setError(getApiError(e,'Không thể cập nhật lựa chọn giỏ hàng.'))}
    }else{
      setGuestCartAllSelected(isSelected);syncGuest();emitCartChange();
    }
  }
  async function remove(item){
    setError('');
    if(item.isGuest){removeGuestCartItem(item.cartItemId);syncGuest();return}
    try{await api.delete('/cart/items/'+item.cartItemId);emitCartChange();await load()}catch(e){setError(getApiError(e,'Không xóa được sản phẩm.'))}
  }
  async function clearAll(){
    if(!window.confirm('Bạn có chắc muốn xóa toàn bộ sản phẩm trong giỏ hàng?'))return;
    setError('');
    if(authenticated){
      try{await api.delete('/cart');emitCartChange();await load()}catch(e){setError(getApiError(e,'Không thể xóa giỏ hàng.'))}
    }else{
      clearGuestCart();syncGuest();emitCartChange();
    }
  }
  async function mergeGuestCart(){
    const pending=beginGuestCartMerge();
    if(!pending)return;
    setMergePending(true);setMergeBusy(true);setError('');
    try{
      await api.post('/cart/merge',pending);
      completeGuestCartMerge(pending.mergeKey || pending.key);syncGuest();emitCartChange();
      setNotice('Giỏ hàng khách đã được gộp vào tài khoản.');
      await load();
    }catch(e){
      if(e.response?.status&&e.response.status<500)clearGuestCartMergePending();
      syncGuest();setError(getApiError(e,'Không xác nhận được kết quả gộp. Hãy thử lại.'));
    }finally{setMergeBusy(false)}
  }
  function renderItem(item){
    const product=item.product;
    return <article className={'commerce-cart-row '+(item.selected?'is-selected':'')} key={(item.isGuest?'guest-':'')+item.cartItemId}>
      <label className="commerce-cart-select"><input type="checkbox" checked={item.selected} disabled={item.isGuest&&mergePending} aria-label={'Chọn '+(product?.name||'sản phẩm')+' để thanh toán'} onChange={event=>selectItem(item,event.target.checked)}/></label>
      <Link to={product?'/products/'+product.id:'/products'} className="commerce-cart-image"><img src={product?.imageUrl||'/icons.svg'} alt={product?.name||'Sản phẩm không khả dụng'}/></Link>
      <div className="commerce-cart-info"><Link to={product?'/products/'+product.id:'/products'}><b>{product?.name||'Sản phẩm không còn khả dụng'}</b></Link><span>{product?money(product.price):'Không còn hàng'}</span>{product&&<small>{item.available?'Còn '+product.stock:'Tồn kho thay đổi; hãy chỉnh số lượng'}</small>}{item.isGuest&&<small>Giá và tồn kho sẽ được kiểm tra lại khi gộp giỏ.</small>}{!item.selected&&<small>Sẽ được giữ trong giỏ sau khi đặt hàng.</small>}</div>
      <div className="commerce-quantity">
        <button aria-label="Giảm số lượng" disabled={item.quantity<=1||(item.isGuest&&mergePending)} onClick={()=>update(item,item.quantity-1)}><Minus size={15}/></button>
        <input type="number" min="1" max={Math.min(99,product?.stock||99)} value={item.quantity} disabled={item.isGuest&&mergePending} onChange={e=>{const val=parseInt(e.target.value,10);if(!isNaN(val))update(item,val)}} aria-label="Số lượng sản phẩm"/>
        <button aria-label="Tăng số lượng" disabled={!product||item.quantity>=product.stock||item.quantity>=99||(item.isGuest&&mergePending)} onClick={()=>update(item,item.quantity+1)}><Plus size={15}/></button>
      </div>
      <b className="commerce-line-total">{money((product?.price||0)*item.quantity)}</b>
      <button className="commerce-trash" aria-label="Xóa sản phẩm" disabled={item.isGuest&&mergePending} onClick={()=>remove(item)}><Trash2 size={17}/></button>
    </article>;
  }

  return <main className="commerce-page">
    <div className="commerce-breadcrumb"><Link to="/">Trang chủ</Link><span>/</span><b>Giỏ hàng</b></div>
    <PageHeading title="Giỏ hàng" subtitle={(authenticated?(cart?.itemCount||0):guestRows.reduce((n,item)=>n+item.quantity,0))+' sản phẩm'}/>
    {notice&&<p className="commerce-alert commerce-alert-success">{notice}</p>}
    {reorderResult?.skippedItems?.length>0&&<div className="commerce-alert commerce-alert-warning">
      <p><b>Lưu ý khi mua lại:</b> Có {reorderResult.skippedItems.length} sản phẩm không thể thêm vào giỏ:</p>
      <ul>{reorderResult.skippedItems.map((s,i)=><li key={i}><b>{s.name}</b>: {s.reason}</li>)}</ul>
    </div>}
    {error&&<p className="commerce-alert">{error}</p>}
    {loading?<div className="commerce-loading">Đang tải giỏ hàng...</div>:!visibleItems.length&&!(authenticated&&guestItems.length)?<div className="commerce-empty"><ShoppingBag size={40}/><h2>Giỏ hàng đang trống</h2><p>Khám phá các món quà trong cửa hàng Giftly.</p><Link className="commerce-button" to="/products">Tiếp tục mua sắm</Link></div>:<div className="commerce-cart-layout">
      <section className="commerce-cart-list">
        {visibleItems.length>0&&<div className="commerce-cart-toolbar">
          <label className="commerce-cart-select-all">
            <input type="checkbox" checked={visibleItems.length>0&&visibleItems.every(i=>i.selected)} onChange={e=>selectAll(e.target.checked)}/>
            <span>Chọn tất cả ({visibleItems.length} sản phẩm)</span>
          </label>
          <button type="button" className="commerce-danger-text" onClick={clearAll}>Xóa tất cả</button>
        </div>}
        {authenticated&&guestItems.length>0&&<div className="commerce-panel"><h2>Sản phẩm từ giỏ khách</h2><p>Các món này vẫn được lưu trên trình duyệt cho đến khi gộp thành công.</p>{guestRows.map(renderItem)}<button className="commerce-button" disabled={mergeBusy} onClick={mergeGuestCart}>{mergeBusy?'Đang gộp...':mergePending?'Thử gộp lại':'Gộp vào giỏ tài khoản'}</button></div>}
        {visibleItems.map(renderItem)}
      </section>
      <aside className="commerce-order-summary"><h2>Tóm tắt đơn hàng</h2><div><span>Đã chọn</span><b>{selectedItems.reduce((count,item)=>count+item.quantity,0)} sản phẩm</b></div><div><span>Tạm tính sản phẩm đã chọn</span><b>{money(subtotal)}</b></div><div><span>Phí giao hàng</span><span>Tính ở bước thanh toán</span></div><div className="commerce-summary-total"><span>Tổng tạm tính</span><b>{money(subtotal)}</b></div><p>Giá và tồn kho được xác nhận lại khi gộp giỏ và đặt hàng. Sản phẩm chưa chọn vẫn ở trong giỏ.</p>
        {!selectedItems.length?<button className="commerce-button commerce-button-full" disabled>Chọn sản phẩm để tiếp tục</button>:selectedUnavailable?<button className="commerce-button commerce-button-full" disabled>Kiểm tra sản phẩm hết hàng</button>:authenticated?<Link className="commerce-button commerce-button-full" to="/checkout">Tiến hành đặt hàng <ArrowRight size={17}/></Link>:<Link className="commerce-button commerce-button-full" to="/login" state={{from:'/checkout'}}>Đăng nhập để tiếp tục <ArrowRight size={17}/></Link>}
        <Link className="commerce-text-link" to="/products">Tiếp tục mua sắm</Link>
      </aside>
    </div>}
  </main>
}
export function CheckoutPage(){
  const checkoutKey=useRef('');
  const [addresses,setAddresses]=useState([]);const [addressId,setAddressId]=useState('');const [couponCode,setCouponCode]=useState('');const [shippingMethod,setShippingMethod]=useState('STANDARD');const [paymentMethod,setPaymentMethod]=useState('COD');const [availableMethods,setAvailableMethods]=useState({COD:true,VNPAY:false});const [note,setNote]=useState('');const [quote,setQuote]=useState(null);const [cart,setCart]=useState(null);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const navigate=useNavigate();
  useEffect(()=>{Promise.all([api.get('/account/addresses'),api.get('/cart'),api.get('/payments/methods')]).then(([a,c,m])=>{setAddresses(a.data.data);setAddressId(a.data.data.find(v=>v.isDefault)?.id||a.data.data[0]?.id||'');setCart(c.data.data);setAvailableMethods(m.data.data||{COD:true,VNPAY:false})}).catch(e=>setError(getApiError(e,'Không tải được thông tin thanh toán.'))).finally(()=>setLoading(false))},[]);
  useEffect(()=>{if(!addressId||!cart?.items?.some(item=>item.selected))return;const timer=setTimeout(()=>api.post('/orders/quote',{addressId,couponCode:couponCode.trim()||undefined,shippingMethod}).then(r=>{setQuote(r.data.data);setError('')}).catch(e=>{setQuote(null);setError(getApiError(e,'Không tính được tổng tiền.'))}),250);return()=>clearTimeout(timer)},[addressId,couponCode,shippingMethod,cart?.items]);
  async function submit(e){e.preventDefault();checkoutKey.current ||= globalThis.crypto?.randomUUID?.()||`giftly-${Date.now()}-${Math.random().toString(36).slice(2)}`;setBusy(true);setError('');try{const {data}=await api.post('/orders',buildCreateOrderPayload({addressId,couponCode,note,paymentMethod,shippingMethod}),{headers:{'Idempotency-Key':checkoutKey.current}});emitCartChange();if(paymentMethod==='VNPAY'){const payment=await api.post(`/payments/orders/${data.data.orderId}/vnpay`);window.location.assign(payment.data.data.paymentUrl);return}if(paymentMethod==='MOMO'){const payment=await api.post(`/payments/orders/${data.data.orderId}/momo`);window.location.assign(payment.data.data.paymentUrl);return}navigate(`/orders/${data.data.orderId}?placed=1`,{replace:true})}catch(e){setError(getApiError(e,'Không thể tạo đơn hàng. Kiểm tra giỏ hàng và thử lại.'))}finally{setBusy(false)}}
  if(loading)return <main className="commerce-page commerce-loading">Đang chuẩn bị thanh toán…</main>;
  if(!cart?.items?.length)return <main className="commerce-page"><div className="commerce-empty"><ShoppingBag/><h1>Giỏ hàng đang trống</h1><Link to="/products">Quay lại cửa hàng</Link></div></main>;
  const selectedItems=cart.items.filter(item=>item.selected);
  if(!selectedItems.length)return <main className="commerce-page"><div className="commerce-empty"><ShoppingBag/><h1>Chưa chọn sản phẩm thanh toán</h1><p>Chọn ít nhất một dòng hàng trong giỏ để tiếp tục.</p><Link className="commerce-button" to="/cart">Quay lại giỏ hàng</Link></div></main>;
  return <main className="commerce-page"><div className="commerce-breadcrumb"><Link to="/cart">Giỏ hàng</Link><span>/</span><b>Thanh toán</b></div><PageHeading title="Xác nhận đơn hàng" subtitle="Chọn phương thức thanh toán cho đơn hàng"/>{error&&<p className="commerce-alert">{error}</p>}
    <form className="commerce-checkout-layout" onSubmit={submit}><section className="commerce-checkout-form"><div className="commerce-panel"><h2>Địa chỉ giao hàng</h2>{addresses.length?addresses.map(a=><label className={`commerce-address-choice ${addressId===a.id?'selected':''}`} key={a.id}><input type="radio" name="address" value={a.id} checked={addressId===a.id} onChange={()=>setAddressId(a.id)}/><span><b>{a.recipientName} · {a.phone}</b><small>{[a.addressLine,a.ward,a.district,a.city].filter(Boolean).join(', ')}</small></span>{a.isDefault&&<em>Mặc định</em>}</label>):<div className="commerce-empty commerce-empty-small"><p>Bạn chưa lưu địa chỉ giao hàng.</p><Link to="/account#addresses">Thêm địa chỉ trong hồ sơ</Link></div>}<Link className="commerce-text-link" to="/account#addresses">Quản lý địa chỉ</Link></div>
      <div className="commerce-panel"><h2>Phương thức giao hàng</h2>{['STANDARD','EXPRESS'].map(method=>{const option=quote?.shippingOptions?.find(item=>item.method===method);return <label className={`commerce-address-choice ${shippingMethod===method?'selected':''}`} key={method}><input type="radio" name="shippingMethod" value={method} checked={shippingMethod===method} onChange={()=>{setShippingMethod(method);setQuote(null)}}/><span><b>{method==='STANDARD'?'Tiêu chuẩn':'Giao nhanh'}</b><small>{option?money(option.fee):'Phí giao hàng sẽ hiện sau khi tính báo giá.'}</small></span>{option?.free&&<em>Miễn phí</em>}</label>})}<p>Phí tiêu chuẩn có thể được miễn theo ngưỡng đơn; giao nhanh không áp dụng ngưỡng này. Lựa chọn và phí là mô phỏng, chưa kết nối hãng vận chuyển.</p></div>
      <div className="commerce-panel"><h2>Thanh toán</h2>{[
        ['COD','Thanh toán khi nhận hàng','Trả tiền cho đơn vị giao hàng khi nhận quà.'],
        ...(availableMethods.VNPAY?[['VNPAY','VNPAY Sandbox · thẻ/ngân hàng nội địa','Bạn sẽ được chuyển tới cổng thanh toán VNPAY.']]:[]),
        ...(availableMethods.MOMO?[['MOMO','Ví MoMo Sandbox · quét mã QR / thẻ ATM','Bạn sẽ được chuyển tới cổng thanh toán Ví MoMo.']]:[])
      ].map(([method,label,desc])=><label className={`commerce-address-choice ${paymentMethod===method?'selected':''}`} key={method}><input type="radio" name="paymentMethod" value={method} checked={paymentMethod===method} onChange={()=>setPaymentMethod(method)}/><span><b>{label}</b><small>{desc}</small></span></label>)}{paymentMethod!=='COD'&&<p>Thanh toán trực tuyến được bảo mật qua cổng thanh toán thử nghiệm Sandbox.</p>}</div><div className="commerce-panel"><h2>Thông tin bổ sung</h2><label>Mã giảm giá<div className="commerce-coupon-row"><input value={couponCode} onChange={e=>setCouponCode(e.target.value.toUpperCase())} maxLength={40} placeholder="Nhập mã giảm giá"/></div></label><label>Ghi chú đơn hàng<textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={1000} placeholder="Lời nhắn cho cửa hàng (không bắt buộc)"/></label></div></section>
      <aside className="commerce-order-summary"><h2>Đơn hàng của bạn</h2>{selectedItems.map(i=><div className="commerce-summary-product" key={i.cartItemId}><span>{i.product?.name||'Sản phẩm'} × {i.quantity}</span><b>{money((i.product?.price||0)*i.quantity)}</b></div>)}<div><span>Tạm tính</span><b>{money(quote?.subtotal??cart.subtotal)}</b></div><div><span>Giảm giá</span><b>− {money(quote?.discount||0)}</b></div>{quote?.coupon?.categoryNames?.length>0&&<p className="commerce-coupon-scope">Mã {quote.coupon.code} chỉ giảm trên: {quote.coupon.categoryNames.join(", ")}. Giá trị đủ điều kiện {money(quote.discountEligibleSubtotal)}.</p>}<div><span>Phương thức giao ({shippingMethod==='STANDARD'?'Tiêu chuẩn':'Nhanh'})</span><b>{quote?.shippingMethod===shippingMethod?money(quote.shippingFee):'—'}</b></div><div className="commerce-summary-total"><span>Tổng cộng</span><b>{quote?.shippingMethod===shippingMethod?money(quote.total):'—'}</b></div><button className="commerce-button commerce-button-full" disabled={busy||!addresses.length||!quote||quote.shippingMethod!==shippingMethod||selectedItems.some(i=>!i.available)}>{busy?'Đang xử lý…':<>{paymentMethod==='COD'?'Đặt hàng COD':'Đặt hàng & thanh toán'} <ArrowRight size={17}/></>}</button><p>Giá và số lượng được xác nhận lại trong giao dịch. Các dòng chưa chọn vẫn được giữ trong giỏ.</p></aside>
    </form>
  </main>
}

export function OrdersPage(){
  const [params,setParams]=useSearchParams();const [items,setItems]=useState([]);const [pagination,setPagination]=useState(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const queryInput=useRef(null);const status=params.get('status')||'',q=params.get('q')||'',page=params.get('page')||'1';

  useEffect(()=>{let alive=true;api.get('/orders',{params:{page,status:status||undefined,q:q||undefined}}).then(r=>{if(alive){setItems(r.data.data.items);setPagination(r.data.data.pagination);setError('')}}).catch(e=>{if(alive)setError(getApiError(e,'Không tải được đơn hàng.'))}).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false}},[page,q,status]);
  function searchOrders(e){e.preventDefault();const next=Object.fromEntries(params);const term=queryInput.current?.value.trim()||'';if(term)next.q=term;else delete next.q;delete next.page;if(term!==q){setLoading(true);setError('')}setParams(next)}
  function changeStatus(value){const next=Object.fromEntries(params);if(value)next.status=value;else delete next.status;delete next.page;if(value!==status){setLoading(true);setError('')}setParams(next)}
  function changePage(value){setLoading(true);setError('');setParams({...Object.fromEntries(params),page:String(value)})}
  function clearSearch(){if(queryInput.current)queryInput.current.value='';if(q){setLoading(true);setError('')}const next=Object.fromEntries(params);delete next.q;delete next.page;setParams(next)}
  return <main className="commerce-page"><div className="commerce-breadcrumb"><Link to="/account">Tài khoản</Link><span>/</span><b>Đơn hàng</b></div><PageHeading title="Đơn hàng của tôi" subtitle="Theo dõi các đơn hàng đã đặt"/><form className="commerce-order-search" onSubmit={searchOrders}><label>Tìm theo mã đơn<input ref={queryInput} key={q} defaultValue={q} maxLength={40} placeholder="Ví dụ: GL..."/></label><button className="commerce-button commerce-button-light">Tìm đơn hàng</button>{q&&<button type="button" className="commerce-text-button" onClick={clearSearch}>Xóa tìm kiếm</button>}</form><label className="commerce-status-filter">Trạng thái<select value={status} onChange={e=>changeStatus(e.target.value)}><option value="">Tất cả</option>{['PENDING','CONFIRMED','PROCESSING','SHIPPED','DELIVERED','CANCELLED'].map(s=><option key={s} value={s}>{getOrderStatusLabel(s)}</option>)}</select></label>{error&&<p className="commerce-alert">{error}</p>}{loading?<div className="commerce-loading">Đang tải đơn hàng…</div>:items.length?<div className="commerce-order-list">{items.map(o=><Link className="commerce-order-row" key={o.id} to={`/orders/${o.id}`}><div><b>{o.orderCode}</b><small>{new Date(o.createdAt).toLocaleString('vi-VN')} · {o.itemCount} sản phẩm</small></div><span className={`commerce-status status-${o.status.toLowerCase()}`}>{getOrderStatusLabel(o)}</span><b>{money(o.total)}</b><ArrowRight size={16}/></Link>)}</div>:<div className="commerce-empty"><Package/><h2>{q||status?'Không tìm thấy đơn hàng phù hợp':'Chưa có đơn hàng'}</h2><Link to="/products">Khám phá sản phẩm</Link></div>}{pagination?.pages>1&&<nav className="commerce-pagination"><button disabled={pagination.page<=1} onClick={()=>changePage(pagination.page-1)}>← Trước</button><span>{pagination.page}/{pagination.pages}</span><button disabled={pagination.page>=pagination.pages} onClick={()=>changePage(pagination.page+1)}>Tiếp →</button></nav>}</main>
}

export function OrderDetailPage(){
  const {id}=useParams();const [params]=useSearchParams();const paymentReturn=params.get('paymentReturn');const [order,setOrder]=useState(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [notice,setNotice]=useState(params.get('placed')?'Đơn hàng đã được tạo thành công.':'');const [returnReason,setReturnReason]=useState('');const [returnDetails,setReturnDetails]=useState('');const [returnRequests,setReturnRequests]=useState([]);
  const navigate=useNavigate();
  async function load(){try{const {data}=await api.get(`/orders/${id}`);setOrder(data.data)}catch(e){setError(getApiError(e,'Không tải được đơn hàng.'))}}
  useEffect(()=>{let active=true;async function loadDetail(){try{const {data}=await api.get(`/orders/${id}`);if(!active)return;setOrder(data.data);setError('');const {data:returns}=await api.get(`/orders/${id}/returns`);if(active)setReturnRequests(returns.data)}catch(e){if(active)setError(getApiError(e,'Không tải được đơn hàng.'))}}loadDetail();return()=>{active=false}},[id]);
  useEffect(()=>{if(paymentReturn!=='awaiting-confirmation')return;let tries=0;const timer=setInterval(async()=>{tries++;try{const {data}=await api.get(`/orders/${id}`);setOrder(data.data);if(data.data.paymentStatus==='PAID'||tries>=10)clearInterval(timer)}catch{if(tries>=10)clearInterval(timer)}},1500);return()=>clearInterval(timer)},[id,paymentReturn]);
  async function payOnline(){setBusy(true);setError('');try{const endpoint=order?.paymentMethod==='MOMO'?`/payments/orders/${id}/momo`:`/payments/orders/${id}/vnpay`;const {data}=await api.post(endpoint);window.location.assign(data.data.paymentUrl)}catch(e){setError(getApiError(e,'Không thể khởi tạo thanh toán.'))}finally{setBusy(false)}}
  async function cancel(){if(!window.confirm('Bạn muốn hủy đơn hàng này?'))return;setBusy(true);try{await api.post(`/orders/${id}/cancel`);setNotice('Đơn hàng đã được hủy.');await load()}catch(e){setError(getApiError(e,'Không thể hủy đơn.'))}finally{setBusy(false)}}
  async function requestReturn(e){e.preventDefault();setBusy(true);try{await api.post(`/orders/${id}/returns`,{reason:returnReason,details:returnDetails});const {data}=await api.get(`/orders/${id}/returns`);setReturnRequests(data.data);setNotice('Yêu cầu đổi trả đã được gửi để cửa hàng xem xét.');setReturnReason('');setReturnDetails('')}catch(e){setError(getApiError(e,'Không gửi được yêu cầu.'))}finally{setBusy(false)}}
  async function confirmReceived(){setBusy(true);setError('');try{await api.post(`/orders/${id}/confirm-received`);setNotice('Đã ghi nhận bạn nhận được hàng.');await load()}catch(e){setError(getApiError(e,'Không xác nhận được đã nhận hàng.'))}finally{setBusy(false)}}
  async function reorder(){
    setBusy(true);setError('');
    try{
      const {data}=await api.post(`/orders/${id}/reorder`);
      emitCartChange();
      navigate('/cart',{
        state:{
          message:data.message||'Sản phẩm từ đơn hàng đã được thêm vào giỏ hàng.',
          reorderResult:data.data
        }
      });
    }catch(e){
      if(e.response?.status === 429){
        setError('Yêu cầu mua lại đang được xử lý hoặc vừa được gửi. Vui lòng kiểm tra giỏ hàng.');
      }else{
        setError(getApiError(e,'Không thể mua lại đơn hàng. Kiểm tra tình trạng sản phẩm và giỏ hàng.'));
      }
    }finally{
      setBusy(false);
    }
  }
  if(!order)return <main className="commerce-page">{error?<div className="commerce-empty"><h1>Không tìm thấy đơn</h1><p>{error}</p></div>:<div className="commerce-loading">Đang tải đơn hàng…</div>}</main>;
  return <main className="commerce-page"><div className="commerce-breadcrumb"><Link to="/orders">Đơn hàng</Link><span>/</span><b>{order.orderCode}</b></div>{paymentReturn==='awaiting-confirmation'&&<p className={order.paymentStatus==='PAID'?'commerce-alert commerce-alert-success':'commerce-alert'}>{order.paymentStatus==='PAID'?'Cổng thanh toán đã xác nhận đơn hàng thành công!':'Đã quay về từ cổng thanh toán; Giftly đang xử lý xác nhận đơn hàng.'}</p>}{paymentReturn==='not-completed'&&<p className="commerce-alert commerce-alert-danger">Giao dịch thanh toán chưa hoàn tất hoặc đã bị hủy. Đơn hàng vẫn ở trạng thái Chưa thanh toán; bạn có thể bấm nút "Tiếp tục thanh toán" bên dưới để thực hiện lại.</p>}{notice&&<p className="commerce-alert commerce-alert-success">{notice}</p>}{error&&<p className="commerce-alert">{error}</p>}<div className="commerce-page-heading"><div><span className="commerce-kicker">ĐƠN HÀNG</span><h1>{order.orderCode}</h1><p>Đặt lúc {new Date(order.createdAt).toLocaleString('vi-VN')}</p></div><span className={`commerce-status status-${order.status.toLowerCase()}`}>{getOrderStatusLabel(order)}</span></div>
    <div className="order-print-action"><button type="button" className="commerce-button commerce-button-light" onClick={() => window.print()}>In / lưu bản tóm tắt</button></div>
<section className="commerce-print-receipt" aria-label="Bản tóm tắt đơn hàng">
  <header className="order-print-brand"><strong>GIFTLY</strong><span>BẢN TÓM TẮT ĐƠN HÀNG</span></header>
  <h1>Đơn hàng {order.orderCode}</h1>
  <p>Đặt lúc {new Date(order.createdAt).toLocaleString('vi-VN')}</p>
  <div className="order-print-status">
    <span>Trạng thái: <b>{getOrderStatusLabel(order)}</b></span>
    <span>Thanh toán: {getPaymentMethodLabel(order.paymentMethod)} · {getPaymentStatusLabel(order.paymentStatus)}</span>
  </div>
  <section className="order-print-address">
    <h2>Thông tin giao hàng</h2>
    <p><b>{order.recipientName}</b><br />{order.phone}<br />{[order.shippingAddress?.addressLine, order.shippingAddress?.ward, order.shippingAddress?.district, order.shippingAddress?.city].filter(Boolean).join(', ')}</p>
  </section>
  <table className="order-print-table">
    <thead><tr><th>Sản phẩm</th><th>Số lượng</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead>
    <tbody>{order.items.map(item => <tr key={item.id}><td>{item.name}</td><td>{item.quantity}</td><td>{money(item.unitPrice)}</td><td>{money(item.lineTotal)}</td></tr>)}</tbody>
  </table>
  <div className="order-print-totals">
    <div><span>Tạm tính</span><b>{money(order.subtotal)}</b></div>
    <div><span>Giảm giá</span><b>− {money(order.discount)}</b></div>
    <div><span>Phí giao hàng</span><b>{money(order.shippingFee)}</b></div>
    <div className="order-print-grand-total"><span>Tổng cộng</span><b>{money(order.total)}</b></div>
  </div>
  {order.customerNote && <p className="order-print-note"><b>Ghi chú:</b> {order.customerNote}</p>}
  <footer>Bản tóm tắt thông tin đơn hàng Giftly; không phải hóa đơn thuế.</footer>
</section><div className="commerce-cart-layout"><section className="commerce-panel"><h2>Sản phẩm</h2>{order.items.map(i=><div className="commerce-cart-row" key={i.id}><div className="commerce-cart-image"><img src={i.imageUrl} alt={i.name}/></div><div className="commerce-cart-info"><b>{i.name}</b><small>{money(i.unitPrice)} × {i.quantity}</small></div><b>{money(i.lineTotal)}</b></div>)}<h2>Lịch sử trạng thái</h2><ol className="commerce-history">{order.history.map((h,i)=><li key={i}><b>{getOrderStatusLabel(h.toStatus)}</b><span>{getOrderHistoryNoteLabel(h.note)}</span><small>{new Date(h.createdAt).toLocaleString('vi-VN')}</small></li>)}</ol></section><aside className="commerce-order-summary"><h2>Giao hàng & thanh toán</h2><p><b>{order.recipientName}</b><br/>{order.phone}</p><p>{[order.shippingAddress?.addressLine,order.shippingAddress?.ward,order.shippingAddress?.district,order.shippingAddress?.city].filter(Boolean).join(', ')}</p><p>{getPaymentMethodLabel(order.paymentMethod)} / {getPaymentStatusLabel(order.paymentStatus)}</p><p>Giao hàng: {getShippingMethodLabel(order.shippingMethod)}</p>{order.shippingCarrier&&<section><h3>Thông tin vận chuyển</h3><p>Đơn vị: <b>{order.shippingCarrier}</b><br/>Mã vận đơn: <b>{order.trackingNumber}</b></p><small>{order.shippingCarrier==='GHN'?'Trạng thái được cập nhật từ webhook GHN.':'Thông tin theo dõi do cửa hàng cập nhật trong Giftly.'}</small>{order.shippingHistory?.length>0&&<ol className="commerce-history">{order.shippingHistory.map((entry,index)=><li key={index}><b>{entry.carrier} · {entry.trackingNumber}</b>{entry.note&&<span>{entry.note}</span>}<small>{new Date(entry.createdAt).toLocaleString('vi-VN')}</small></li>)}</ol>}</section>}<div><span>Tạm tính</span><b>{money(order.subtotal)}</b></div><div><span>Giảm giá</span><b>− {money(order.discount)}</b></div><div><span>Giao hàng</span><b>{money(order.shippingFee)}</b></div><div className="commerce-summary-total"><span>Tổng</span><b>{money(order.total)}</b></div>{['VNPAY','MOMO'].includes(order.paymentMethod)&&order.paymentStatus==='UNPAID'&&order.status==='PENDING'&&<button className="commerce-button commerce-button-full" disabled={busy} onClick={payOnline}>Tiếp tục thanh toán</button>}<button className="commerce-button commerce-button-light commerce-button-full" disabled={busy} onClick={reorder}>Mua lại đơn hàng</button>{['PENDING','CONFIRMED','PROCESSING'].includes(order.status)&&order.paymentStatus==='UNPAID'&&!order.shippingCarrier&&<button className="commerce-button commerce-button-danger commerce-button-full" disabled={busy} onClick={cancel}>Hủy đơn hàng</button>}{order.status==='DELIVERED'&&<section className="commerce-return-form"><h3>{ORDER_RECEIPT_LABEL.TITLE}</h3>{order.canConfirmReceived?<button className="commerce-button" disabled={busy} onClick={confirmReceived}>{ORDER_RECEIPT_LABEL.ACTION}</button>:order.receivedAt?<p>{order.receivedConfirmedAt?ORDER_RECEIPT_LABEL.CONFIRMED:ORDER_RECEIPT_LABEL.AUTOMATIC} - {new Date(order.receivedAt).toLocaleString('vi-VN')}</p>:<p>{ORDER_RECEIPT_LABEL.WAITING}</p>}{order.returnDeadline&&<p>{ORDER_RECEIPT_LABEL.RETURN_DEADLINE}: {new Date(order.returnDeadline).toLocaleString('vi-VN')}</p>}</section>}{returnRequests.length>0&&<section className="commerce-return-form"><h3>Tiến độ đổi trả</h3><p>Hoàn tất đổi trả tại đây chỉ xác nhận hàng đã nhận và nhập kho; Giftly chưa xử lý hoàn tiền tự động.</p>{returnRequests.map(request=><article key={request.id}><b>{request.reason}</b><p>{getReturnStatusLabel(request.status)}</p>{request.adminNote&&<p>Phản hồi cửa hàng: {request.adminNote}</p>}<small>Cập nhật {new Date(request.updatedAt).toLocaleString('vi-VN')}</small></article>)}</section>}{order.status==='DELIVERED'&&!order.returnWindowOpen&&<p>{ORDER_RECEIPT_LABEL.WINDOW_CLOSED}</p>}{order.status==='DELIVERED'&&order.returnWindowOpen&&!returnRequests.some(request=>['PENDING','APPROVED','COMPLETED'].includes(request.status))&&<form onSubmit={requestReturn} className="commerce-return-form"><h3>Yêu cầu đổi trả</h3><input required maxLength={120} value={returnReason} onChange={e=>setReturnReason(e.target.value)} placeholder="Lý do đổi trả"/><textarea maxLength={1000} value={returnDetails} onChange={e=>setReturnDetails(e.target.value)} placeholder="Mô tả thêm"/><button className="commerce-button commerce-button-light" disabled={busy}>Gửi yêu cầu</button></form>}</aside></div><Link className="commerce-text-link" to="/orders">← Danh sách đơn hàng</Link>
  </main>
}
