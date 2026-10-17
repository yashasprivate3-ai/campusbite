import { useEffect, useState } from 'react'
import { fetchOwnerStock, saveOwnerStock } from '../services/ownerStockApi.js'

export function OwnerStockPanel() {
  const [stock, setStock] = useState(null)
  const [quantities, setQuantities] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    let cancelled = false

    fetchOwnerStock().then(result => {
      if (cancelled) return

      setStock(result)
      setQuantities(
        Object.fromEntries(
          result.items.map(item => [
            item.id,
            item.confirmed ? String(item.quantity) : '',
          ]),
        ),
      )
    }).catch(err => {
      if (!cancelled) {
        setError(err.message || 'Unable to load stock.')
      }
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [])

  function updateQuantity(id, value) {
    setQuantities(current => ({ ...current, [id]: value }))
    setSuccess('')
  }

  function resetChanges() {
    if (!stock) return

    setQuantities(
      Object.fromEntries(
        stock.items.map(item => [
          item.id,
          item.confirmed ? String(item.quantity) : '',
        ]),
      ),
    )
    setError('')
    setSuccess('')
  }

  async function handleSave(event) {
    event.preventDefault()
    if (!stock || saving) return

    const items = stock.items
      .filter(item => quantities[item.id]?.trim() !== '')
      .map(item => ({
        id: item.id,
        quantity: Number(quantities[item.id]),
      }))

    if (items.length === 0) {
      setError('Enter at least one stock quantity.')
      return
    }

    if (items.some(item =>
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 0 ||
      item.quantity > 100000
    )) {
      setError('Enter whole-number quantities between 0 and 100000.')
      return
    }

    setSaving(true)
    setError('')
    setSuccess('')

    try {
      const result = await saveOwnerStock(items)
      setStock(result)
      setQuantities(
        Object.fromEntries(
          result.items.map(item => [
            item.id,
            item.confirmed ? String(item.quantity) : '',
          ]),
        ),
      )
      setSuccess('Todayâ€™s stock has been confirmed successfully.')
    } catch (err) {
      setError(err.message || 'Unable to save stock.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <section className="owner-foundation-card">
        <h2>Today's Stock</h2>
        <p>Loading stock information...</p>
      </section>
    )
  }

  return (
    <section className="owner-foundation-card" aria-labelledby="stock-title">
      <div>
        <p className="eyebrow">Daily inventory confirmation</p>
        <h2 id="stock-title">Today's Stock</h2>
        <p>
          Confirm actual available quantities before students can order.
          Blank means unconfirmed. Zero means sold out.
        </p>
        {stock && <p>Service date: {stock.serviceDate}</p>}
      </div>

      {error && <p role="alert">{error}</p>}
      {success && <p role="status">{success}</p>}

      {stock && (
        <form onSubmit={handleSave}>
          <div className="owner-stock-list">
            {stock.items.map(item => (
              <div className="owner-stock-item" key={item.id}>
                <label htmlFor={`stock-${item.id}`}>
                  <strong>{item.name}</strong>
                  <span>
                    {' '}â€” Reserved: {item.reserved}
                    {' '}| Remaining: {item.remaining ?? 'Not confirmed'}
                  </span>
                </label>

                <input
                  id={`stock-${item.id}`}
                  type="number"
                  min="0"
                  max="100000"
                  step="1"
                  inputMode="numeric"
                  value={quantities[item.id] ?? ''}
                  onChange={event =>
                    updateQuantity(item.id, event.target.value)
                  }
                  disabled={saving}
                  placeholder="Unconfirmed"
                />
              </div>
            ))}
          </div>

          <div className="owner-stock-actions">
            <button
              className="primary-action"
              type="submit"
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Confirm Stock'}
            </button>

            <button
              type="button"
              onClick={resetChanges}
              disabled={saving}
            >
              Reset Changes
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
