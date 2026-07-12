export function calculateBatches(orders) {
  const batchMap = {}

  orders
    .filter((order) => order.status !== "ready")
    .forEach((order) => {
      order.items.forEach((item) => {
        if (!batchMap[item.name]) {
          batchMap[item.name] = {
            itemName: item.name,
            requiredQuantity: 0,
            linkedOrders: []
          }
        }

        batchMap[item.name].requiredQuantity += item.quantity

        batchMap[item.name].linkedOrders.push(order.token)
      })
    })

  return Object.values(batchMap)
}
