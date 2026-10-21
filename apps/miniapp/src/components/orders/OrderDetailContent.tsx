"use client";
import { useCallback, useEffect, useState } from "react";
import { getUserOrder, ApiRequestError } from "../../lib/api-client";
import { readAccessToken } from "../../lib/auth-storage";
import {
  ordersError,
  type CustomerOrder,
  type OrdersError,
} from "../../lib/orders";
import { useTelegramSession } from "../TelegramSession";
import { Page } from "../ui/foundation";
import { OrdersFailure, OrdersLoading } from "./OrderParts";
import { OrderDetailView } from "./OrderDetailView";
import { useOrdersRefresh } from "./useOrdersRefresh";
function ActiveDetail({ publicId }: { publicId: string }) {
  const [order, setOrder] = useState<CustomerOrder>(),
    [error, setError] = useState<OrdersError>(),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useOrdersRefresh(refresh);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 15000);
    setLoading(true);
    setError(undefined);
    async function load() {
      try {
        const token = readAccessToken();
        if (!token) throw new ApiRequestError(401);
        const response = await getUserOrder(publicId, token, controller.signal);
        if (!disposed && !controller.signal.aborted) setOrder(response);
      } catch (err) {
        if (!disposed) setError(ordersError(err));
      } finally {
        clearTimeout(timer);
        if (!disposed) setLoading(false);
      }
    }
    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [publicId, revision]);
  if (!order && loading) return <OrdersLoading detail />;
  if (!order || error === "auth" || error === "missing")
    return (
      <Page className="orders-page">
        <OrdersFailure error={error ?? "request"} retry={refresh} />
      </Page>
    );
  return (
    <OrderDetailView
      order={order}
      loading={loading}
      error={error}
      refresh={refresh}
    />
  );
}
export function OrderDetailContent({ publicId }: { publicId: string }) {
  const { status } = useTelegramSession();
  if (status === "loading") return <OrdersLoading detail />;
  if (status !== "authenticated")
    return (
      <Page className="orders-page">
        <OrdersFailure error="auth" retry={() => window.location.reload()} />
      </Page>
    );
  return <ActiveDetail key={publicId} publicId={publicId} />;
}
