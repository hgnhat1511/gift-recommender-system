import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, Minus, Package, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import api, { getApiError, getAuth } from '../../lib/api.js';
import { beginGuestCartMerge, clearGuestCartMergePending, completeGuestCartMerge, getGuestCart, getPendingGuestCartMerge, removeGuestCartItem, updateGuestCartItem } from '../../lib/guestCart.js';
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
  const guestIds=guestItems.map(item=>item.productId);
  const guestKey=guestIds.join(',');
  const guestRows=guestItems.map(item=>{const product=guestProducts[item.productId]||null;return {cartItemId:item.productId,quantity:item.quantity,selected:item.selected,product,available:Boolean(product&&product.stock>=item.quantity),isGuest:true}});
  const visibleItems=authenticated?(cart?.items||[]):guestRows;
  const selectedItems=visibleItems.filter(item=>item.selected);
  const selectedUnavailable=selectedItems.some(item=>!item.available);
  const subtotal=authenticated?Number(cart?.subtotal||0):selectedItems.reduce((total,item)=>total+(item.product?.price||0)*item.quantity,0);

  async function load(){setLoading(true);try{const {data}=await api.get('/cart');setCart(data.data)}catch(e){setError(getApiError(e,'Kh\u00f4ng t\u1ea3i \u0111\u01b0\u1ee3c gi\u1ecf h\u00e0ng.'))}finally{setLoading(false)}}
  useEffect(()=>{
    if(!authenticated)return;
    let active=true;
    api.get('/cart').then(({data})=>{if(active)setCart(data.data)}).catch(e=>{if(active)setError(getApiError(e,'Kh\u00f4ng t\u1ea3i \u0111\u01b0\u1ee3c gi\u1ecf h\u00e0ng.'))}).finally(()=>{if(active)setLoading(false)});
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
    setError('');
    if(item.isGuest){updateGuestCartItem(item.cartItemId,{quantity});syncGuest();return}
    try{await api.patch('/cart/items/'+item.cartItemId,{quantity});await load()}catch(e){setError(getApiError(e,'Kh\u00f4ng c\u1eadp nh\u1eadt \u0111\u01b0\u1ee3c s\u1ed1 l\u01b0\u1ee3ng.'));await load()}
  }
  async function selectItem(item,isSelected){
    setError('');
    if(item.isGuest){updateGuestCartItem(item.cartItemId,{selected:isSelected});syncGuest();return}
    try{await api.patch('/cart/items/'+item.cartItemId+'/selection',{isSelected});await load()}catch(e){setError(getApiError(e,'Kh\u00f4ng th\u1ec3 thay \u0111\u1ed5i l\u1ef1a ch\u1ecdn.'))}
  }
  async function remove(item){
    setError('');
    if(item.isGuest){removeGuestCartItem(item.cartItemId);syncGuest();return}
    try{await api.delete('/cart/items/'+item.cartItemId);await load()}catch(e){setError(getApiError(e,'Kh\u00f4ng x\u00f3a \u0111\u01b0\u1ee3c s\u1ea3n ph\u1ea9m.'))}
  }
  async function mergeGuestCart(){
    const pending=beginGuestCartMerge();
    if(!pending)return;
    setMergePending(true);setMergeBusy(true);setError('');
    try{
      await api.post('/cart/merge',pending);
      completeGuestCartMerge(pending.key);syncGuest();
      setNotice('Gi\u1ecf h\u00e0ng kh\u00e1ch \u0111\u00e3 \u0111\u01b0\u1ee3c g\u1ed9p v\u00e0o t\u00e0i kho\u1ea3n.');
      await load();
    }catch(e){
      if(e.response?.status&&e.response.status<500)clearGuestCartMergePending();
      syncGuest();setError(getApiError(e,'Kh\u00f4ng x\u00e1c nh\u1eadn \u0111\u01b0\u1ee3c k\u1ebft qu\u1ea3 g\u1ed9p. H\u00e3y th\u1eed l\u1ea1i.'));
    }finally{setMergeBusy(false)}
  }
  function renderItem(item){
    const product=item.product;
    return <article className={'commerce-cart-row '+(item.selected?'is-selected':'')} key={(item.isGuest?'guest-':'')+item.cartItemId}>
      <label className="commerce-cart-select"><input type="checkbox" checked={item.selected} disabled={item.isGuest&&mergePending} aria-label={'Ch\u1ecdn '+(product?.name||'s\u1ea3n ph\u1ea9m')+' \u0111\u1ec3 thanh to\u00e1n'} onChange={event=>selectItem(item,event.target.checked)}/></label>
      <Link to={product?'/products/'+product.id:'/products'} className="commerce-cart-image"><img src={product?.imageUrl||'/icons.svg'} alt={product?.name||'S\u1ea3n ph\u1ea9m kh\u00f4ng kh\u1ea3 d\u1ee5ng'}/></Link>
      <div className="commerce-cart-info"><Link to={product?'/products/'+product.id:'/products'}><b>{product?.name||'S\u1ea3n ph\u1ea9m kh\u00f4ng c\u00f2n kh\u1ea3 d\u1ee5ng'}</b></Link><span>{product?money(product.price):'Kh\u00f4ng c\u00f2n h\u00e0ng'}</span>{product&&<small>{item.available?'C\u00f2n '+product.stock:'T\u1ed3n kho thay \u0111\u1ed5i; h\u00e3y ch\u1ec9nh s\u1ed1 l\u01b0\u1ee3ng'}</small>}{item.isGuest&&<small>Gi&#225; v&#224; t&#7891;n kho s&#7869; &#273;&#432;&#7907;c ki&#7875;m tra l&#7841;i khi g&#7897;p gi&#7887;.</small>}{!item.selected&&<small>S&#7869; &#273;&#432;&#7907;c gi&#7919; trong gi&#7887; sau khi &#273;&#7863;t h&#224;ng.</small>}</div>
      <div className="commerce-quantity"><button aria-label="Gi&#7843;m s&#7889; l&#432;&#7907;ng" disabled={item.quantity<=1||item.isGuest&&mergePending} onClick={()=>update(item,item.quantity-1)}><Minus size={15}/></button><span>{item.quantity}</span><button aria-label="T&#259;ng s&#7889; l&#432;&#7907;ng" disabled={!product||item.quantity>=product.stock||item.quantity>=99||item.isGuest&&mergePending} onClick={()=>update(item,item.quantity+1)}><Plus size={15}/></button></div>
      <b className="commerce-line-total">{money((product?.price||0)*item.quantity)}</b>
      <button className="commerce-trash" aria-label="X&#243;a s&#7843;n ph&#7849;m" disabled={item.isGuest&&mergePending} onClick={()=>remove(item)}><Trash2 size={17}/></button>
    </article>;
  }

  return <main className="commerce-page">
    <div className="commerce-breadcrumb"><Link to="/">Trang ch&#7911;</Link><span>/</span><b>Gi&#7887; h&#224;ng</b></div>
    <PageHeading title="Gi&#7887; h&#224;ng" subtitle={(authenticated?(cart?.itemCount||0):guestRows.reduce((n,item)=>n+item.quantity,0))+' s&#7843;n ph&#7849;m'}/>
    {notice&&<p className="commerce-alert commerce-alert-success">{notice}</p>}{error&&<p className="commerce-alert">{error}</p>}
    {loading?<div className="commerce-loading">&#272;ang t&#7843;i gi&#7887; h&#224;ng...</div>:!visibleItems.length&&!(authenticated&&guestItems.length)?<div className="commerce-empty"><ShoppingBag size={40}/><h2>Gi&#7887; h&#224;ng &#273;ang tr&#7889;ng</h2><p>Kh&#225;m ph&#225; c&#225;c m&#243;n qu&#224; trong c&#7917;a h&#224;ng Giftly.</p><Link className="commerce-button" to="/products">Ti&#7871;p t&#7909;c mua s&#7855;m</Link></div>:<div className="commerce-cart-layout">
      <section className="commerce-cart-list">
        {authenticated&&guestItems.length>0&&<div className="commerce-panel"><h2>S&#7843;n ph&#7849;m t&#7915; gi&#7887; kh&#225;ch</h2><p>C&#225;c m&#243;n n&#224;y v&#7851;n &#273;&#432;&#7907;c l&#432;u tr&#234;n tr&#236;nh duy&#7879;t cho &#273;&#7871;n khi g&#7897;p th&#224;nh c&#244;ng.</p>{guestRows.map(renderItem)}<button className="commerce-button" disabled={mergeBusy} onClick={mergeGuestCart}>{mergeBusy?'&#272;ang g&#7897;p...':mergePending?'Th&#7917; g&#7897;p l&#7841;i':'G&#7897;p v&#224;o gi&#7887; t&#224;i kho&#7843;n'}</button></div>}
        {visibleItems.map(renderItem)}
      </section>
      <aside className="commerce-order-summary"><h2>T&#243;m t&#7855;t &#273;&#417;n h&#224;ng</h2><div><span>&#272;&#227; ch&#7885;n</span><b>{selectedItems.reduce((count,item)=>count+item.quantity,0)} s&#7843;n ph&#7849;m</b></div><div><span>T&#7841;m t&#237;nh s&#7843;n ph&#7849;m &#273;&#227; ch&#7885;n</span><b>{money(subtotal)}</b></div><div><span>Ph&#237; giao h&#224;ng</span><span>T&#237;nh &#7903; b&#432;&#7899;c thanh to&#225;n</span></div><div className="commerce-summary-total"><span>T&#7893;ng t&#7841;m t&#237;nh</span><b>{money(subtotal)}</b></div><p>Gi&#225; v&#224; t&#7891;n kho &#273;&#432;&#7907;c x&#225;c nh&#7853;n l&#7841;i khi g&#7897;p gi&#7887; v&#224; &#273;&#7863;t h&#224;ng. S&#7843;n ph&#7849;m ch&#432;a ch&#7885;n v&#7851;n &#7903; trong gi&#7887;.</p>
        {!selectedItems.length?<button className="commerce-button commerce-button-full" disabled>Ch&#7885;n s&#7843;n ph&#7849;m &#273;&#7875; ti&#7871;p t&#7909;c</button>:selectedUnavailable?<button className="commerce-button commerce-button-full" disabled>Ki&#7875;m tra s&#7843;n ph&#7849;m h&#7871;t h&#224;ng</button>:authenticated?<Link className="commerce-button commerce-button-full" to="/checkout">Ti&#7871;n h&#224;nh &#273;&#7863;t h&#224;ng <ArrowRight size={17}/></Link>:<Link className="commerce-button commerce-button-full" to="/login" state={{from:'/checkout'}}>&#272;&#259;ng nh&#7853;p &#273;&#7875; ti&#7871;p t&#7909;c <ArrowRight size={17}/></Link>}
        <Link className="commerce-text-link" to="/products">Ti&#7871;p t&#7909;c mua s&#7855;m</Link>
      </aside>
    </div>}
  </main>
}
export function CheckoutPage(){
  const checkoutKey=useRef('');
  const [addresses,setAddresses]=useState([]);const [addressId,setAddressId]=useState('');const [couponCode,setCouponCode]=useState('');const [shippingMethod,setShippingMethod]=useState('STANDARD');const [note,setNote]=useState('');const [quote,setQuote]=useState(null);const [cart,setCart]=useState(null);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const navigate=useNavigate();
  useEffect(()=>{Promise.all([api.get('/account/addresses'),api.get('/cart')]).then(([a,c])=>{setAddresses(a.data.data);setAddressId(a.data.data.find(v=>v.isDefault)?.id||a.data.data[0]?.id||'');setCart(c.data.data)}).catch(e=>setError(getApiError(e,'Không tải được thông tin thanh toán.'))).finally(()=>setLoading(false))},[]);
  useEffect(()=>{if(!addressId||!cart?.items?.some(item=>item.selected))return;const timer=setTimeout(()=>api.post('/orders/quote',{addressId,couponCode:couponCode.trim()||undefined,shippingMethod}).then(r=>{setQuote(r.data.data);setError('')}).catch(e=>{setQuote(null);setError(getApiError(e,'Không tính được tổng tiền.'))}),250);return()=>clearTimeout(timer)},[addressId,couponCode,shippingMethod,cart?.items]);
  async function submit(e){e.preventDefault();checkoutKey.current ||= globalThis.crypto?.randomUUID?.()||`giftly-${Date.now()}-${Math.random().toString(36).slice(2)}`;setBusy(true);setError('');try{const {data}=await api.post('/orders',{addressId,couponCode:couponCode.trim()||undefined,note,paymentMethod:'COD',shippingMethod},{headers:{'Idempotency-Key':checkoutKey.current}});navigate(`/orders/${data.data.orderId}?placed=1`,{replace:true})}catch(e){setError(getApiError(e,'Không thể tạo đơn hàng. Kiểm tra giỏ hàng và thử lại.'))}finally{setBusy(false)}}
  if(loading)return <main className="commerce-page commerce-loading">Đang chuẩn bị thanh toán…</main>;
  if(!cart?.items?.length)return <main className="commerce-page"><div className="commerce-empty"><ShoppingBag/><h1>Giỏ hàng đang trống</h1><Link to="/products">Quay lại cửa hàng</Link></div></main>;
  const selectedItems=cart.items.filter(item=>item.selected);
  if(!selectedItems.length)return <main className="commerce-page"><div className="commerce-empty"><ShoppingBag/><h1>Chưa chọn sản phẩm thanh toán</h1><p>Chọn ít nhất một dòng hàng trong giỏ để tiếp tục.</p><Link className="commerce-button" to="/cart">Quay lại giỏ hàng</Link></div></main>;
  return <main className="commerce-page"><div className="commerce-breadcrumb"><Link to="/cart">Giỏ hàng</Link><span>/</span><b>Thanh toán</b></div><PageHeading title="Xác nhận đơn hàng" subtitle="Thanh toán khi nhận hàng (COD)"/>{error&&<p className="commerce-alert">{error}</p>}
    <form className="commerce-checkout-layout" onSubmit={submit}><section className="commerce-checkout-form"><div className="commerce-panel"><h2>Địa chỉ giao hàng</h2>{addresses.length?addresses.map(a=><label className={`commerce-address-choice ${addressId===a.id?'selected':''}`} key={a.id}><input type="radio" name="address" value={a.id} checked={addressId===a.id} onChange={()=>setAddressId(a.id)}/><span><b>{a.recipientName} · {a.phone}</b><small>{[a.addressLine,a.ward,a.district,a.city].filter(Boolean).join(', ')}</small></span>{a.isDefault&&<em>Mặc định</em>}</label>):<div className="commerce-empty commerce-empty-small"><p>Bạn chưa lưu địa chỉ giao hàng.</p><Link to="/account#addresses">Thêm địa chỉ trong hồ sơ</Link></div>}<Link className="commerce-text-link" to="/account#addresses">Quản lý địa chỉ</Link></div>
      <div className="commerce-panel"><h2>Phương thức giao hàng</h2>{['STANDARD','EXPRESS'].map(method=>{const option=quote?.shippingOptions?.find(item=>item.method===method);return <label className={`commerce-address-choice ${shippingMethod===method?'selected':''}`} key={method}><input type="radio" name="shippingMethod" value={method} checked={shippingMethod===method} onChange={()=>{setShippingMethod(method);setQuote(null)}}/><span><b>{method==='STANDARD'?'Tiêu chuẩn':'Giao nhanh'}</b><small>{option?money(option.fee):'Phí giao hàng sẽ hiện sau khi tính báo giá.'}</small></span>{option?.free&&<em>Miễn phí</em>}</label>})}<p>Phí tiêu chuẩn có thể được miễn theo ngưỡng đơn; giao nhanh không áp dụng ngưỡng này. Lựa chọn và phí là mô phỏng, chưa kết nối hãng vận chuyển.</p></div>
      <div className="commerce-panel"><h2>Thông tin bổ sung</h2><label>Mã giảm giá<div className="commerce-coupon-row"><input value={couponCode} onChange={e=>setCouponCode(e.target.value.toUpperCase())} maxLength={40} placeholder="Nhập mã giảm giá"/></div></label><label>Ghi chú đơn hàng<textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={1000} placeholder="Lời nhắn cho cửa hàng (không bắt buộc)"/></label><div className="commerce-payment-note"><b>Thanh toán khi nhận hàng</b><span>Bạn thanh toán trực tiếp cho đơn vị giao hàng khi nhận quà. Chưa tích hợp cổng thanh toán trực tuyến.</span></div></div></section>
      <aside className="commerce-order-summary"><h2>Đơn hàng của bạn</h2>{selectedItems.map(i=><div className="commerce-summary-product" key={i.cartItemId}><span>{i.product?.name||'Sản phẩm'} × {i.quantity}</span><b>{money((i.product?.price||0)*i.quantity)}</b></div>)}<div><span>Tạm tính</span><b>{money(quote?.subtotal??cart.subtotal)}</b></div><div><span>Giảm giá</span><b>− {money(quote?.discount||0)}</b></div>{quote?.coupon?.categoryNames?.length>0&&<p className="commerce-coupon-scope">Mã {quote.coupon.code} chỉ giảm trên: {quote.coupon.categoryNames.join(", ")}. Giá trị đủ điều kiện {money(quote.discountEligibleSubtotal)}.</p>}<div><span>Phương thức giao ({shippingMethod==='STANDARD'?'Tiêu chuẩn':'Nhanh'})</span><b>{quote?.shippingMethod===shippingMethod?money(quote.shippingFee):'?'}</b></div><div className="commerce-summary-total"><span>Tổng cộng</span><b>{quote?.shippingMethod===shippingMethod?money(quote.total):'?'}</b></div><button className="commerce-button commerce-button-full" disabled={busy||!addresses.length||!quote||quote.shippingMethod!==shippingMethod||selectedItems.some(i=>!i.available)}>{busy?'Đang tạo đơn…':<>Đặt hàng COD <ArrowRight size={17}/></>}</button><p>Giá và số lượng được xác nhận lại trong giao dịch. Các dòng chưa chọn vẫn được giữ trong giỏ.</p></aside>
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
  return <main className="commerce-page"><div className="commerce-breadcrumb"><Link to="/account">Tài khoản</Link><span>/</span><b>Đơn hàng</b></div><PageHeading title="Đơn hàng của tôi" subtitle="Theo dõi các đơn hàng đã đặt"/><form className="commerce-order-search" onSubmit={searchOrders}><label>Tìm theo mã đơn<input ref={queryInput} key={q} defaultValue={q} maxLength={40} placeholder="Ví dụ: GL..."/></label><button className="commerce-button commerce-button-light">Tìm đơn hàng</button>{q&&<button type="button" className="commerce-text-button" onClick={clearSearch}>Xóa tìm kiếm</button>}</form><label className="commerce-status-filter">Trạng thái<select value={status} onChange={e=>changeStatus(e.target.value)}><option value="">Tất cả</option>{['PENDING','CONFIRMED','PROCESSING','SHIPPED','DELIVERED','CANCELLED'].map(s=><option key={s}>{s}</option>)}</select></label>{error&&<p className="commerce-alert">{error}</p>}{loading?<div className="commerce-loading">Đang tải đơn hàng…</div>:items.length?<div className="commerce-order-list">{items.map(o=><Link className="commerce-order-row" key={o.id} to={`/orders/${o.id}`}><div><b>{o.orderCode}</b><small>{new Date(o.createdAt).toLocaleString('vi-VN')} · {o.itemCount} sản phẩm</small></div><span className={`commerce-status status-${o.status.toLowerCase()}`}>{o.status}</span><b>{money(o.total)}</b><ArrowRight size={16}/></Link>)}</div>:<div className="commerce-empty"><Package/><h2>{q||status?'Không tìm thấy đơn hàng phù hợp':'Chưa có đơn hàng'}</h2><Link to="/products">Khám phá sản phẩm</Link></div>}{pagination?.pages>1&&<nav className="commerce-pagination"><button disabled={pagination.page<=1} onClick={()=>changePage(pagination.page-1)}>← Trước</button><span>{pagination.page}/{pagination.pages}</span><button disabled={pagination.page>=pagination.pages} onClick={()=>changePage(pagination.page+1)}>Tiếp →</button></nav>}</main>
}

export function OrderDetailPage(){
  const {id}=useParams();const [params]=useSearchParams();const [order,setOrder]=useState(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [notice,setNotice]=useState(params.get('placed')?'Đơn hàng đã được tạo thành công.':'');const [returnReason,setReturnReason]=useState('');const [returnDetails,setReturnDetails]=useState('');const [returnRequests,setReturnRequests]=useState([]);const [reordered,setReordered]=useState(false);
  async function load(){try{const {data}=await api.get(`/orders/${id}`);setOrder(data.data)}catch(e){setError(getApiError(e,'Không tải được đơn hàng.'))}}
  useEffect(()=>{let active=true;async function loadDetail(){try{const {data}=await api.get(`/orders/${id}`);if(!active)return;setOrder(data.data);setError('');const {data:returns}=await api.get(`/orders/${id}/returns`);if(active)setReturnRequests(returns.data)}catch(e){if(active)setError(getApiError(e,'Không tải được đơn hàng.'))}}loadDetail();return()=>{active=false}},[id]);
  async function cancel(){if(!window.confirm('Bạn muốn hủy đơn hàng này?'))return;setBusy(true);try{await api.post(`/orders/${id}/cancel`);setNotice('Đơn hàng đã được hủy.');await load()}catch(e){setError(getApiError(e,'Không thể hủy đơn.'))}finally{setBusy(false)}}
  async function requestReturn(e){e.preventDefault();setBusy(true);try{await api.post(`/orders/${id}/returns`,{reason:returnReason,details:returnDetails});const {data}=await api.get(`/orders/${id}/returns`);setReturnRequests(data.data);setNotice('Yêu cầu đổi trả đã được gửi để cửa hàng xem xét.');setReturnReason('');setReturnDetails('')}catch(e){setError(getApiError(e,'Không gửi được yêu cầu.'))}finally{setBusy(false)}}
async function reorder(){setBusy(true);setError('');try{await api.post(`/orders/${id}/reorder`);setReordered(true);setNotice('Sản phẩm trong đơn đã được thêm vào giỏ. Hãy kiểm tra giá và tồn kho trước khi đặt lại.')}catch(e){setError(getApiError(e,'Không thể mua lại đơn hàng. Kiểm tra tình trạng sản phẩm và giỏ hàng.'))}finally{setBusy(false)}}
  if(!order)return <main className="commerce-page">{error?<div className="commerce-empty"><h1>Không tìm thấy đơn</h1><p>{error}</p></div>:<div className="commerce-loading">Đang tải đơn hàng…</div>}</main>;
  return <main className="commerce-page"><div className="commerce-breadcrumb"><Link to="/orders">Đơn hàng</Link><span>/</span><b>{order.orderCode}</b></div>{notice&&<p className="commerce-alert commerce-alert-success">{notice}{reordered&&<> <Link to="/cart">Mở giỏ hàng</Link></>}</p>}{error&&<p className="commerce-alert">{error}</p>}<div className="commerce-page-heading"><div><span className="commerce-kicker">ĐƠN HÀNG</span><h1>{order.orderCode}</h1><p>Đặt lúc {new Date(order.createdAt).toLocaleString('vi-VN')}</p></div><span className={`commerce-status status-${order.status.toLowerCase()}`}>{order.status}</span></div>
    <div className="order-print-action"><button type="button" className="commerce-button commerce-button-light" onClick={() => window.print()}>In / lưu bản tóm tắt</button></div>
<section className="commerce-print-receipt" aria-label="Bản tóm tắt đơn hàng">
  <header className="order-print-brand"><strong>GIFTLY</strong><span>BẢN TÓM TẮT ĐƠN HÀNG</span></header>
  <h1>Đơn hàng {order.orderCode}</h1>
  <p>Đặt lúc {new Date(order.createdAt).toLocaleString('vi-VN')}</p>
  <div className="order-print-status">
    <span>Trạng thái: <b>{order.status}</b></span>
    <span>Thanh toán: {order.paymentMethod === 'COD' ? 'Thanh toán khi nhận hàng' : order.paymentMethod} · {order.paymentStatus}</span>
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
</section><div className="commerce-cart-layout"><section className="commerce-panel"><h2>Sản phẩm</h2>{order.items.map(i=><div className="commerce-cart-row" key={i.id}><div className="commerce-cart-image"><img src={i.imageUrl} alt={i.name}/></div><div className="commerce-cart-info"><b>{i.name}</b><small>{money(i.unitPrice)} × {i.quantity}</small></div><b>{money(i.lineTotal)}</b></div>)}<h2>Lịch sử trạng thái</h2><ol className="commerce-history">{order.history.map((h,i)=><li key={i}><b>{h.toStatus}</b><span>{h.note}</span><small>{new Date(h.createdAt).toLocaleString('vi-VN')}</small></li>)}</ol></section><aside className="commerce-order-summary"><h2>Giao hàng & thanh toán</h2><p><b>{order.recipientName}</b><br/>{order.phone}</p><p>{[order.shippingAddress?.addressLine,order.shippingAddress?.ward,order.shippingAddress?.district,order.shippingAddress?.city].filter(Boolean).join(', ')}</p><p>COD / {order.paymentStatus}</p><p>Giao hàng: {order.shippingMethod==='EXPRESS'?'Nhanh':'Tiêu chuẩn'}</p>{order.shippingCarrier&&<section><h3>Thông tin vận chuyển</h3><p>Đơn vị: <b>{order.shippingCarrier}</b><br/>Mã vận đơn: <b>{order.trackingNumber}</b></p><small>Thông tin cập nhật nội bộ của Giftly, chưa đồng bộ trực tiếp với hãng vận chuyển.</small>{order.shippingHistory?.length>0&&<ol className="commerce-history">{order.shippingHistory.map((entry,index)=><li key={index}><b>{entry.carrier} · {entry.trackingNumber}</b>{entry.note&&<span>{entry.note}</span>}<small>{new Date(entry.createdAt).toLocaleString('vi-VN')}</small></li>)}</ol>}</section>}<div><span>Tạm tính</span><b>{money(order.subtotal)}</b></div><div><span>Giảm giá</span><b>− {money(order.discount)}</b></div><div><span>Giao hàng</span><b>{money(order.shippingFee)}</b></div><div className="commerce-summary-total"><span>Tổng</span><b>{money(order.total)}</b></div><button className="commerce-button commerce-button-light commerce-button-full" disabled={busy} onClick={reorder}>Mua lại đơn hàng</button>{order.status==='PENDING'&&<button className="commerce-button commerce-button-danger commerce-button-full" disabled={busy} onClick={cancel}>Hủy đơn hàng</button>}{returnRequests.length>0&&<section className="commerce-return-form"><h3>Tiến độ đổi trả</h3>{returnRequests.map(request=><article key={request.id}><b>{request.reason}</b><p>{request.status==='PENDING'?'Đang chờ cửa hàng xem xét':request.status==='APPROVED'?'Đã chấp nhận':request.status==='REJECTED'?'Đã từ chối':'Đã hoàn tất'}</p>{request.adminNote&&<p>Phản hồi cửa hàng: {request.adminNote}</p>}<small>Cập nhật {new Date(request.updatedAt).toLocaleString('vi-VN')}</small></article>)}</section>}{order.status==='DELIVERED'&&!returnRequests.some(request=>['PENDING','APPROVED','COMPLETED'].includes(request.status))&&<form onSubmit={requestReturn} className="commerce-return-form"><h3>Yêu cầu đổi trả</h3><input required maxLength={120} value={returnReason} onChange={e=>setReturnReason(e.target.value)} placeholder="Lý do đổi trả"/><textarea maxLength={1000} value={returnDetails} onChange={e=>setReturnDetails(e.target.value)} placeholder="Mô tả thêm"/><button className="commerce-button commerce-button-light" disabled={busy}>Gửi yêu cầu</button></form>}</aside></div><Link className="commerce-text-link" to="/orders">← Danh sách đơn hàng</Link>
  </main>
}
