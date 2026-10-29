export const menu = [
  { id: 1, name: 'Veg Fried Rice', category: 'Meals', price: 70, icon: '🍚', time: '8–10 min', stock: 18, popular: true },
  { id: 2, name: 'Masala Dosa', category: 'Meals', price: 55, icon: '🥞', time: '7–9 min', stock: 12, popular: true },
  { id: 3, name: 'Grilled Sandwich', category: 'Snacks', price: 45, icon: '🥪', time: '5–7 min', stock: 8 },
  { id: 4, name: 'Samosa', category: 'Ready now', price: 20, icon: '🥟', time: 'Ready now', stock: 24 },
  { id: 5, name: 'Filter Coffee', category: 'Beverages', price: 25, icon: '☕', time: '2–3 min', stock: 30, popular: true },
  { id: 6, name: 'Masala Tea', category: 'Beverages', price: 15, icon: '🍵', time: 'Ready now', stock: 32 },
]

export const seededOrders = [
  { id: 'CB-1042', student: 'Aarav Sharma', items: '2× Veg Fried Rice, 1× Tea', total: 155, status: 'PREPARING', minutes: 4 },
  { id: 'CB-1043', student: 'Meera Rao', items: '1× Masala Dosa, 1× Coffee', total: 80, status: 'NEW', minutes: 1 },
  { id: 'CB-1041', student: 'Riya Patel', items: '2× Samosa, 1× Coffee', total: 65, status: 'READY', minutes: 8 },
]
