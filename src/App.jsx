import { useState } from 'react'
import './App.css'

const menuItems = [
  {
    id: 1,
    name: 'Veg Fried Rice',
    description: 'Wok-tossed rice with fresh vegetables and house seasoning.',
    price: 70,
    category: 'Meals',
    emoji: '🍚',
    time: '8–10 min',
    popular: true,
  },
  {
    id: 2,
    name: 'Masala Dosa',
    description: 'Crisp dosa served with potato masala, chutney and sambar.',
    price: 55,
    category: 'Meals',
    emoji: '🥞',
    time: '7–9 min',
  },
  {
    id: 3,
    name: 'Grilled Sandwich',
    description: 'Toasted vegetable sandwich with a warm, crisp finish.',
    price: 45,
    category: 'Snacks',
    emoji: '🥪',
    time: '5–7 min',
  },
  {
    id: 4,
    name: 'Samosa',
    description: 'Fresh, crisp and ready for a quick pickup.',
    price: 20,
    category: 'Ready now',
    emoji: '🥟',
    time: 'Ready now',
  },
  {
    id: 5,
    name: 'Filter Coffee',
    description: 'Freshly brewed, strong and served hot.',
    price: 25,
    category: 'Beverages',
    emoji: '☕',
    time: '2–3 min',
  },
  {
    id: 6,
    name: 'Masala Tea',
    description: 'Comforting tea brewed with milk and aromatic spices.',
    price: 15,
    category: 'Beverages',
    emoji: '🍵',
    time: 'Ready now',
  },
]

const categories = ['All', 'Ready now', 'Meals', 'Snacks', 'Beverages']

function App() {
  const [activeCategory, setActiveCategory] = useState('All')
  const [cart, setCart] = useState({})
  const [isCartOpen, setIsCartOpen] = useState(false)

  const visibleItems =
    activeCategory === 'All'
      ? menuItems
      : menuItems.filter((item) => item.category === activeCategory)

  const cartItems = menuItems.filter((item) => cart[item.id])
  const cartCount = cartItems.reduce((total, item) => total + cart[item.id], 0)
  const cartTotal = cartItems.reduce(
    (total, item) => total + item.price * cart[item.id],
    0,
  )

  function addItem(itemId) {
    setCart((currentCart) => ({
      ...currentCart,
      [itemId]: (currentCart[itemId] || 0) + 1,
    }))
  }

  function removeItem(itemId) {
    setCart((currentCart) => {
      const nextQuantity = (currentCart[itemId] || 0) - 1
      const nextCart = { ...currentCart }

      if (nextQuantity <= 0) {
        delete nextCart[itemId]
      } else {
        nextCart[itemId] = nextQuantity
      }

      return nextCart
    })
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="CampusBite home">
          <span className="brand-mark">CB</span>
          <span>
            <strong>CampusBite</strong>
            <small>Working name</small>
          </span>
        </a>

        <button
          className="header-cart"
          type="button"
          onClick={() => setIsCartOpen(true)}
          aria-label={`Open cart with ${cartCount} items`}
        >
          <span>My cart</span>
          <span className="cart-count">{cartCount}</span>
        </button>
      </header>

      <main id="top">
        <section className="welcome-card">
          <div>
            <p className="eyebrow">Canteen is open</p>
            <h1>Good afternoon, Yashas.</h1>
            <p className="welcome-copy">
              Choose your meal, pay online and collect it when it is ready.
            </p>
          </div>

          <div className="service-status" aria-label="Current service status">
            <span className="status-dot"></span>
            <span>
              <strong>Normal service</strong>
              <small>Estimated pickup: 8–10 min</small>
            </span>
          </div>
        </section>

        <section className="menu-section" aria-labelledby="menu-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Fresh from the canteen</p>
              <h2 id="menu-title">Today’s menu</h2>
            </div>
            <p>{visibleItems.length} items available</p>
          </div>

          <div className="category-tabs" aria-label="Menu categories">
            {categories.map((category) => (
              <button
                className={activeCategory === category ? 'active' : ''}
                key={category}
                type="button"
                onClick={() => setActiveCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>

          <div className="menu-grid">
            {visibleItems.map((item) => {
              const quantity = cart[item.id] || 0

              return (
                <article className="food-card" key={item.id}>
                  <div className="food-visual" aria-hidden="true">
                    <span>{item.emoji}</span>
                    {item.popular && <em>Popular</em>}
                  </div>

                  <div className="food-content">
                    <div className="food-title-row">
                      <h3>{item.name}</h3>
                      <strong>₹{item.price}</strong>
                    </div>
                    <p>{item.description}</p>
                    <span className="prep-time">{item.time}</span>

                    {quantity === 0 ? (
                      <button
                        className="add-button"
                        type="button"
                        onClick={() => addItem(item.id)}
                      >
                        Add to cart
                      </button>
                    ) : (
                      <div className="quantity-control" aria-label={`${item.name} quantity`}>
                        <button type="button" onClick={() => removeItem(item.id)}>
                          −
                        </button>
                        <span>{quantity}</span>
                        <button type="button" onClick={() => addItem(item.id)}>
                          +
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      </main>

      {cartCount > 0 && (
        <button className="cart-bar" type="button" onClick={() => setIsCartOpen(true)}>
          <span>
            <strong>{cartCount} {cartCount === 1 ? 'item' : 'items'}</strong>
            <small>₹{cartTotal}</small>
          </span>
          <span>View cart →</span>
        </button>
      )}

      {isCartOpen && (
        <div className="cart-overlay" role="presentation" onMouseDown={() => setIsCartOpen(false)}>
          <aside
            className="cart-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cart-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="cart-header">
              <div>
                <p className="eyebrow">Your order</p>
                <h2 id="cart-title">My cart</h2>
              </div>
              <button type="button" onClick={() => setIsCartOpen(false)} aria-label="Close cart">
                ×
              </button>
            </div>

            {cartItems.length === 0 ? (
              <div className="empty-cart">
                <span>🧺</span>
                <h3>Your cart is empty</h3>
                <p>Add something from today’s menu to begin.</p>
                <button type="button" onClick={() => setIsCartOpen(false)}>
                  Browse menu
                </button>
              </div>
            ) : (
              <>
                <div className="cart-items">
                  {cartItems.map((item) => (
                    <div className="cart-item" key={item.id}>
                      <span className="cart-item-emoji" aria-hidden="true">{item.emoji}</span>
                      <div>
                        <strong>{item.name}</strong>
                        <small>₹{item.price} each</small>
                      </div>
                      <div className="mini-quantity">
                        <button type="button" onClick={() => removeItem(item.id)}>−</button>
                        <span>{cart[item.id]}</span>
                        <button type="button" onClick={() => addItem(item.id)}>+</button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="cart-summary">
                  <div>
                    <span>Item total</span>
                    <strong>₹{cartTotal}</strong>
                  </div>
                  <p>Payment and order confirmation will be connected in the next stage.</p>
                  <button className="checkout-button" type="button" disabled>
                    Continue to payment · ₹{cartTotal}
                  </button>
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}

export default App
