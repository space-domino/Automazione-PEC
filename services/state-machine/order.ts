import type { Order, OrderStatus, Prisma } from "@prisma/client";
import type { EntityStateConfig } from "./engine";

/**
 * Macchina a stati dell'Order (sezione E.5).
 * NB: la colonna è `orderStatus`, non `status`: `load` la rimappa su `status`
 * per il motore generico, `apply` scrive di nuovo su `orderStatus`.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING: ["PAID", "CANCELLED"],
  PAID: ["FULFILLMENT_PENDING", "REFUNDED", "CANCELLED"],
  FULFILLMENT_PENDING: ["TRANSFERRED", "REFUNDED"],
  TRANSFERRED: ["COMPLETED", "REFUNDED"],
  COMPLETED: [],
  CANCELLED: [],
  REFUNDED: [],
};

/** Stati finali/finanziari: mai raggiungibili via forceTransition. */
const ORDER_PROTECTED: readonly OrderStatus[] = ["COMPLETED", "REFUNDED", "CANCELLED"];

type OrderRow = Order & { status: OrderStatus };

export const orderStateConfig: EntityStateConfig<OrderRow, OrderStatus> = {
  entityType: "Order",
  transitions: ORDER_TRANSITIONS,
  protectedStates: ORDER_PROTECTED,
  load: async (tx, id) => {
    const o = await tx.order.findUnique({ where: { id } });
    return o ? { ...o, status: o.orderStatus } : null;
  },
  apply: async (tx, id, to, extra) => {
    await tx.order.update({
      where: { id },
      data: { orderStatus: to, ...((extra ?? {}) as Prisma.OrderUpdateInput) },
    });
  },
};
