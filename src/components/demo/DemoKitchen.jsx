import { useEffect, useMemo, useState } from 'react'
import { seededOrders } from './demoData.js'

const nextStatus = { NEW: 'PREPARING', PREPARING: 'READY' }

export default function DemoKitchen({ notify }) {
  const [orders, setOrders] = useState(seededOrders)
  const [seconds, setSeconds] = useState(0)
  useEffect(() => { const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000); return () => window.clearInterval(timer) }, [])
  const batches = useMemo(() => [{ item: 'Veg Fried Rice', quantity: 4, orders: ['CB-1042', 'CB-1045'] }, { item: 'Masala Dosa', quantity: 3, orders: ['CB-1043', 'CB-1046', 'CB-1048'] }], [])
  function advance(id) { setOrders((current) => current.map((order) => order.id === id ? { ...order, status: nextStatus[order.status] || order.status } : order)); const order = orders.find((item) => item.id === id); const status = nextStatus[order.status]; notify(status === 'READY' ? `${id} is ready for pickup` : `${id} moved to preparing`) }
  return <main className="demo-page"><div className="section-title"><div><p className="eyebrow">Kitchen operations</p><h1>Live production queue</h1></div><span className="live-badge">● LIVE · {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</span></div><div className="metrics">{['NEW', 'PREPARING', 'READY'].map((status) => <article key={status}><small>{status}</small><strong>{orders.filter((order) => order.status === status).length}</strong></article>)}<article><small>Average wait</small><strong>6 min</strong></article></div><section><p className="eyebrow">Smart batch merging</p><h2>Active batches</h2><div className="batch-grid">{batches.map((batch) => <article key={batch.item}><span>🔥</span><div><h3>{batch.item}</h3><strong>{batch.quantity} portions</strong><small>Merged: {batch.orders.join(' + ')}</small></div><div className="batch-timer">{8 + Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</div></article>)}</div></section><section><p className="eyebrow">Order queue</p><h2>Move orders through the kitchen</h2><div className="orders">{orders.map((order) => <article key={order.id}><div><small>{order.student} · {order.minutes} min ago</small><h2>{order.id}</h2><p>{order.items}</p></div><div className="order-actions"><span className={`status-${order.status.toLowerCase()}`}>{order.status}</span>{nextStatus[order.status] ? <button onClick={() => advance(order.id)} type="button">Mark {nextStatus[order.status]}</button> : <strong>✓ Pickup counter</strong>}</div></article>)}</div></section></main>
}
