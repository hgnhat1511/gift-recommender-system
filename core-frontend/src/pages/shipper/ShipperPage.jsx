import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, MapPin, Phone, RefreshCw, Truck, XCircle } from 'lucide-react';
import api, { getApiError } from '../../lib/api.js';
import { getOrderStatusLabel, SHIPPER_LABEL } from '../../lib/labels.js';

const money = (value) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(value || 0));

export default function ShipperPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [photo, setPhoto] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const reload = useCallback(async () => {
    try {
      const { data } = await api.get('/shipper/orders');
      setOrders(data.data);
      setError('');
    } catch (e) {
      setError(getApiError(e, 'Không tải được danh sách giao hàng.'));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let active = true;
    api.get('/shipper/orders').then(({ data }) => {
      if (active) { setOrders(data.data); setError(''); }
    }).catch((e) => {
      if (active) setError(getApiError(e, 'Không tải được danh sách giao hàng.'));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  async function act(order, action) {
    setBusy(`${order.id}:${action}`); setError(''); setNotice('');
    try {
      if (action === 'deliver' && photo?.orderId === order.id) {
        await api.post(`/shipper/orders/${order.id}/proof`, photo.file, { headers: { 'Content-Type': photo.file.type } });
      }
      await api.post(`/shipper/orders/${order.id}/${action}`);
      setNotice(action === 'deliver' ? SHIPPER_LABEL.CONFIRM_DELIVERED : SHIPPER_LABEL.START_DELIVERY);
      if (photo?.orderId === order.id) setPhoto(null);
      await reload();
    } catch (e) {
      setError(getApiError(e, 'Không cập nhật được đơn hàng.'));
      await reload();
    } finally { setBusy(''); }
  }

  async function fail(order) {
    const reason = window.prompt('Nhập lý do giao thất bại (VD: Không liên lạc được khách, địa chỉ sai, khách đổi ý...):', 'Không liên lạc được khách hàng');
    if (reason === null) return;
    setBusy(`${order.id}:fail`); setError(''); setNotice('');
    try {
      await api.post(`/shipper/orders/${order.id}/fail`, { reason });
      setNotice(`Đã báo giao thất bại đơn ${order.orderCode}.`);
      await reload();
    } catch (e) {
      setError(getApiError(e, 'Không thể cập nhật trạng thái thất bại.'));
      await reload();
    } finally { setBusy(''); }
  }

  return <main className="commerce-page">
    <div className="commerce-breadcrumb"><Link to="/">Giftly</Link><span>/</span><b>{SHIPPER_LABEL.PAGE_TITLE}</b></div>
    <div className="commerce-page-heading"><div><span className="commerce-kicker">VẬN CHUYỂN</span><h1>{SHIPPER_LABEL.PAGE_TITLE}</h1><p>{SHIPPER_LABEL.PAGE_DESCRIPTION}</p></div></div>
    <div className="admin-toolbar"><button className="commerce-button commerce-button-light" onClick={() => { setLoading(true); reload(); }}><RefreshCw size={16}/> {SHIPPER_LABEL.REFRESH}</button></div>
    {notice && <p className="commerce-alert commerce-alert-success">{notice}</p>}
    {error && <p className="commerce-alert">{error}</p>}
    {loading ? <div className="commerce-loading">{SHIPPER_LABEL.LOADING}</div> : orders.length === 0 ? <div className="commerce-empty"><Truck/><h2>{SHIPPER_LABEL.EMPTY_TITLE}</h2><p>{SHIPPER_LABEL.EMPTY_DESCRIPTION}</p></div> :
      <div className="commerce-order-list">{orders.map((order) => {
        const address = order.shippingAddress || {};
        const action = order.status === 'PROCESSING' ? 'dispatch' : order.status === 'SHIPPED' ? 'deliver' : null;
        return <article className="commerce-panel" key={order.id}>
          <div className="commerce-section-heading"><div><span className="commerce-kicker">{order.orderCode}</span><h2>{getOrderStatusLabel(order.status)}</h2></div><b>{money(order.total)}</b></div>
          <p><b>{order.recipientName}</b> · <a href={`tel:${order.phone}`}><Phone size={14}/> {order.phone}</a></p>
          <p><MapPin size={15}/> {[address.addressLine, address.ward, address.district, address.city].filter(Boolean).join(', ')}</p>
          <p>{order.paymentMethod === 'COD' ? SHIPPER_LABEL.COD_NOTE : SHIPPER_LABEL.ONLINE_PAID_NOTE} · {SHIPPER_LABEL.INTERNAL_TRACKING}: {order.trackingNumber || order.orderCode}</p>
          {order.shipperUserId && <p style={{ fontSize: '0.85rem', color: '#64748b' }}>Phân công: Shipper #{order.shipperUserId}</p>}
          {order.status === 'SHIPPED' && <label className="shipper-proof-upload">{SHIPPER_LABEL.PROOF_PHOTO}<small>{SHIPPER_LABEL.PHOTO_OPTIONAL}</small><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhoto(event.target.files?.[0] ? { orderId: order.id, file: event.target.files[0] } : null)}/></label>}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
            {action && <button className="commerce-button" disabled={Boolean(busy)} onClick={() => act(order, action)}>
              {busy === `${order.id}:${action}` ? SHIPPER_LABEL.LOADING : action === 'deliver' ? SHIPPER_LABEL.CONFIRM_DELIVERED : SHIPPER_LABEL.START_DELIVERY} <ArrowRight size={16}/>
            </button>}
            {order.status === 'SHIPPED' && <button className="commerce-button commerce-button-light" disabled={Boolean(busy)} onClick={() => fail(order)} style={{ color: '#ef4444', borderColor: '#fca5a5' }}>
              <XCircle size={16}/> Báo giao thất bại
            </button>}
          </div>
        </article>;
      })}</div>}
  </main>;
}
