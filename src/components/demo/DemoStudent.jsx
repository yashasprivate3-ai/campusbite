import { useEffect, useMemo, useState } from 'react'
import heroImage from '../../assets/hero.png'
import { menu } from './demoData.js'

const trackingSteps = ['Order accepted', 'Preparing', 'Cooking', 'Ready for pickup', 'Picked up']

function DemoCheckout({ amount, onClose, onResult }) {
  return <div className="checkout-overlay"><section className="checkout-modal" role="dialog" aria-modal="true" aria-label="Demo Razorpay checkout"><header><div><strong>CB</strong><span>CampusBite</span></div><button onClick={() => { onResult('cancel'); onClose() }} type="button">×</button></header><div className="checkout-body"><p className="eyebrow">Razorpay-style Demo Checkout</p><h2>Pay ₹{amount}</h2><div className="secure-row">🔒 Test payment · no money will be charged</div><label>Card number<input readOnly value="4111 1111 1111 1111" /></label><div className="checkout-fields"><label>Expiry<input readOnly value="12 / 30" /></label><label>CVV<input readOnly value="•••" /></label></div><div className="checkout-options"><button onClick={() => { onResult('success'); onClose() }} type="button">✓ Simulate success</button><button onClick={() => { onResult('failure'); onClose() }} type="button">✕ Simulate failure</button><button onClick={() => { onResult('cancel'); onClose() }} type="button">Cancel payment</button></div></div><footer>Secured by <strong>Razorpay Demo</strong></footer></section></div>
}

export default function DemoStudent({ notify }) {
  const [category, setCategory] = useState('All')
  const [cart, setCart] = useState({})
  const [checkout, setCheckout] = useState(false)
  const [order, setOrder] = useState(null)
  const [trackingIndex, setTrackingIndex] = useState(0)
  const shown = category === 'All' ? menu : menu.filter((item) => item.category === category)
  const cartItems = menu.filter((item) => cart[item.id])
  const total = useMemo(() => cartItems.reduce((sum, item) => sum + item.price * cart[item.id], 0), [cart, cartItems])
  const change = (id, amount) => setCart((current) => ({ ...current, [id]: Math.max(0, (current[id] || 0) + amount) }))

  useEffect(() => {
    if (!order || trackingIndex >= trackingSteps.length - 1) return undefined
    const timer = window.setTimeout(() => {
      const next = trackingIndex + 1
      setTrackingIndex(next)
      notify(trackingSteps[next] === 'Ready for pickup' ? 'Your order is ready for pickup!' : `Order update: ${trackingSteps[next]}`)
    }, 3500)
    return () => window.clearTimeout(timer)
  }, [notify, order, trackingIndex])

  function paymentResult(result) {
    if (result === 'success') {
      const sequence = Math.floor(1050 + Math.random() * 800)
      setOrder({ id: `CB-${sequence}`, paymentId: `pay_demo_${Date.now()}`, placedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), total })
      setTrackingIndex(0); setCart({}); notify('Payment successful · order accepted')
    } else notify(result === 'failure' ? 'Payment failed safely. Your cart is preserved.' : 'Payment cancelled. Your cart is preserved.')
  }

  return <main>
    <section className="demo-hero"><div><span className="demo-pill">Student · Priya Sharma</span><p className="eyebrow">Your campus canteen, without the wait</p><h1>Fresh food. Faster pickup.</h1><p>Choose a meal, simulate secure payment and watch your order move through the live kitchen.</p><button onClick={() => document.querySelector('#student-menu')?.scrollIntoView({ behavior: 'smooth' })} type="button">Order lunch</button></div><img alt="A fresh CampusBite meal" src={heroImage} /></section>
    {order ? <section className="tracking-card"><div className="section-title"><div><p className="eyebrow">Live order tracking</p><h2>{order.id}</h2><small>Payment {order.paymentId} · {order.placedAt}</small></div><strong>₹{order.total}</strong></div><div className="tracking-line">{trackingSteps.map((step, index) => <div className={index <= trackingIndex ? 'complete' : ''} key={step}><span>{index < trackingIndex ? '✓' : index + 1}</span><strong>{step}</strong></div>)}</div></section> : null}
    <section className="demo-layout" id="student-menu"><div><div className="section-title"><div><p className="eyebrow">Made fresh today</p><h2>Campus favourites</h2></div><span>{shown.length} available</span></div><div className="categories">{['All', 'Ready now', 'Meals', 'Snacks', 'Beverages'].map((name) => <button className={category === name ? 'active' : ''} key={name} onClick={() => setCategory(name)} type="button">{name}</button>)}</div><div className="menu-grid">{shown.map((item) => <article className="menu-card" key={item.id}><div className="food-icon">{item.icon}{item.popular ? <em>Popular</em> : null}</div><div><small>{item.category} · {item.time}</small><h3>{item.name}</h3><strong>₹{item.price}</strong><span className={item.stock < 10 ? 'stock-low' : 'stock-ok'}>{item.stock < 10 ? `Only ${item.stock} left` : 'In stock'}</span></div><button onClick={() => change(item.id, 1)} type="button">Add</button></article>)}</div></div>
      <aside className="demo-cart"><p className="eyebrow">Your order</p><h2>Cart</h2>{cartItems.length ? cartItems.map((item) => <div className="cart-row" key={item.id}><div><strong>{item.name}</strong><small>₹{item.price} each</small></div><div className="quantity"><button onClick={() => change(item.id, -1)} type="button">−</button><span>{cart[item.id]}</span><button onClick={() => change(item.id, 1)} type="button">+</button></div></div>) : <p className="empty-cart">Add something delicious from the menu.</p>}<div className="subtotal"><span>Subtotal</span><strong>₹{total}</strong></div><div className="total"><span>Total</span><strong>₹{total}</strong></div><button className="primary-demo-action" disabled={!total} onClick={() => setCheckout(true)} type="button">Checkout securely</button><small>Demo payment only · nothing is charged</small></aside>
    </section>{checkout ? <DemoCheckout amount={total} onClose={() => setCheckout(false)} onResult={paymentResult} /> : null}
  </main>
}
