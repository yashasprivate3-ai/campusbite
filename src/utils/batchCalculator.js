export function calculateBatches(orders) {
  const batchMap = {}

  orders.forEach((order) => {
    order.items.forEach((item) => {
      if (!batchMap[item.name]) {
        batchMap[item.name] = {
          itemName: item.name,
          requiredQuantity: 0,
          linkedOrders: [],
        }
      }

      batchMap[item.name].requiredQuantity += item.quantity

      if (!batchMap[item.name].linkedOrders.includes(order.token)) {
        batchMap[item.name].linkedOrders.push(order.token)
      }
    })
  })

  return Object.values(batchMap)
}
